'use client';

import { useState, useCallback, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LocateFixed,
  Search, Radar, Globe, Shield, FileText, Radio,
  ChevronDown, ChevronUp, Loader2, AlertTriangle, Server,
  Wifi, Lock, MapPin, Bug, Code, Layers, Network, Fingerprint,
  CheckCircle, XCircle, Clock, ExternalLink, Crosshair,
  Maximize2, Minimize2, Gavel, Bitcoin, Phone, Terminal, ShieldAlert,
  Building2, BookOpen, IdCard, Star, Users
} from 'lucide-react';
import { ipToNumber, numberToIp, calculateSubnetStart, classifyDevice, assessRisk, batchFetch, ShodanInternetDBResponse, SweepDevice } from '@/lib/osint-utils';
import { FLAGS } from '@/config/featureFlags';

const TABS = [
  { id: 'dns', label: 'DNS', icon: Server, placeholder: 'Domain name', color: '#448AFF' },
  { id: 'whois', label: 'WHOIS', icon: FileText, placeholder: 'Domain name', color: '#FFD700' },
  { id: 'certs', label: 'CERTS', icon: Lock, placeholder: 'Domain name', color: '#E040FB' },
  { id: 'threats', label: 'THREATS', icon: AlertTriangle, placeholder: 'IP, domain, or hash', color: '#FF9500' },
  { id: 'headers', label: 'HEADERS', icon: Code, placeholder: 'URL to inspect', color: '#87CEEB' },
  { id: 'ssl', label: 'SSL/TLS', icon: Shield, placeholder: 'Domain name', color: '#76FF03' },
  { id: 'subdomains', label: 'SUBDOMAINS', icon: Layers, placeholder: 'Domain to enumerate', color: '#00BCD4' },
  { id: 'tech', label: 'TECH DETECT', icon: Code, placeholder: 'URL to fingerprint', color: '#9C27B0' },
  { id: 'shodan', label: 'SHODAN IOT', icon: Network, placeholder: 'IP address', color: '#FF3D3D' },
  { id: 'bgp', label: 'BGP ROUTE', icon: Globe, placeholder: 'IP or ASN', color: '#00E5FF' },
  { id: 'mac', label: 'MAC ADDR', icon: Fingerprint, placeholder: 'MAC address', color: '#FFD700' },
  { id: 'phone', label: 'PHONE INTEL', icon: Phone, placeholder: 'Phone number (e.g. +1...)', color: '#FF9500' },
  { id: 'leaks', label: 'DATA LEAKS', icon: ShieldAlert, placeholder: 'Email address', color: '#E040FB' },
  { id: 'github', label: 'GITHUB RECON', icon: Terminal, placeholder: 'GitHub username', color: '#87CEEB' },
  { id: 'sweep', label: 'IP SWEEP', icon: Crosshair, placeholder: 'Enter IP address (e.g. 8.8.8.8)', color: '#FF3D3D' },
  { id: 'sec-edgar', label: 'SEC EDGAR', icon: BookOpen, placeholder: 'Company name or keyword', color: '#00C853' },
  { id: 'gleif', label: 'LEI LOOKUP', icon: IdCard, placeholder: 'Legal entity name or LEI code', color: '#D4AF37' },
  { id: 'reviews', label: 'REVIEWS', icon: Star, placeholder: 'Brand name or App Store ID (e.g. 284882215)', color: '#FF6B35' },
  { id: 'social', label: 'SOCIAL & PEOPLE', icon: Users, placeholder: 'Company or person name / LinkedIn URL', color: '#0077B5' },
];

// Tabs gated behind activeReconEnabled flag
const ACTIVE_RECON_TAB_IDS = new Set(['sweep', 'shodan', 'leaks']);

interface OsintPanelProps { isOpen?: boolean; onClose?: () => void; isMobile?: boolean; onSweepVisualize?: (data: any) => void; onScanGeolocate?: (target: string, data: any) => void; }

function OsintPanelInner({ isMobile, onSweepVisualize, onScanGeolocate }: OsintPanelProps) {
  const [activeTab, setActiveTab] = useState('dns');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanType, setScanType] = useState('quick');
  const [expanded, setExpanded] = useState(true);
  const [history, setHistory] = useState<{tab:string;query:string;time:string}[]>([]);
  const [sweepResult, setSweepResult] = useState<any>(null);
  const [sweepProgress, setSweepProgress] = useState<{ current: number; total: number } | null>(null);
  const [sweepCidr, setSweepCidr] = useState(24);
  const [cveCache, setCveCache] = useState<Record<string, any>>({});
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);

  // Fetch CVE details when a device is expanded in full-screen mode
  const fetchCveDetails = useCallback(async (cveIds: string[]) => {
    const missing = cveIds.filter(id => !cveCache[id]);
    if (missing.length === 0) return;
    // Mark as loading
    setCveCache(prev => {
      const next = { ...prev };
      for (const id of missing) next[id] = { loading: true };
      return next;
    });
    // Fetch in parallel
    const results = await Promise.allSettled(
      missing.map(id => fetch(`/api/osint/cve?cve=${encodeURIComponent(id)}`).then(r => r.json()).then(data => ({ id, data })))
    );
    setCveCache(prev => {
      const next = { ...prev };
      for (const r of results) {
        if (r.status === 'fulfilled') {
          next[r.value.id] = r.value.data;
        }
      }
      return next;
    });
  }, [cveCache]);

    const handleSelfTrack = () => {
      setLoading(true);
      setError('');
      fetch('/api/geo')
        .then(r => {
          if (!r.ok) throw new Error(`Server returned ${r.status}`);
          return r.json();
        })
        .then(geo => {
          setLoading(false);
          if (geo.status === 'success' && geo.lat && geo.lon && onScanGeolocate) {
            onScanGeolocate(geo.query || 'local', {
              lat: geo.lat,
              lng: geo.lon,
              city: geo.city || 'Unknown',
              country: geo.country || 'Unknown',
              isp: geo.isp || 'Unknown',
              org: geo.org || 'Unknown',
              as: geo.as || 'Unknown',
              type: 'self_track'
            });
          } else {
            setError("Could not retrieve your IP location.");
          }
        })
        .catch(err => {
          setLoading(false);
          setError("Network error: " + err.message);
        });
    };

  const runLookup = useCallback(async () => {
    if (!query.trim() || loading) return;
    setLoading(true); setError(''); setResults(null);

    // IP Sweep / Vuln Scan — separate flow
    if (activeTab === 'sweep') {
      setSweepResult(null);
      const cidr = sweepCidr;
      const totalHosts = Math.pow(2, 32 - cidr);
      setSweepProgress({ current: 0, total: totalHosts });
      try {
        const t0 = Date.now();
        const res = await fetch(`/api/osint/sweep?ip=${encodeURIComponent(query)}&cidr=${cidr}`);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Sweep failed (${res.status})`); }
        const initData = await res.json();

        const ipParts = initData.target_ip.split('.').map(Number) as [number, number, number, number];
        const ipNum = ipToNumber(ipParts);
        const subnetStart = calculateSubnetStart(ipNum, cidr);
        const subnet = numberToIp(subnetStart);

        const urls: string[] = [];
        for (let i = 0; i < totalHosts; i++) {
          urls.push(`https://internetdb.shodan.io/${numberToIp((subnetStart + i) >>> 0)}`);
        }

        const shodanResults = await batchFetch<ShodanInternetDBResponse>(urls, 15, async (u) => {
          try {
            const r = await fetch(u, { cache: 'no-store' });
            if (r.status === 404) return null;
            if (!r.ok) return null;
            return await r.json();
          } catch {
            return null;
          }
        }, (done) => setSweepProgress({ current: done, total: totalHosts }));

        const devices: SweepDevice[] = [];
        const deviceBreakdown: Record<string, number> = {};
        for (const sr of shodanResults) {
          if (!sr) continue;
          const classification = classifyDevice(sr.ports, sr.cpes, sr.tags);
          const risk = assessRisk({ ports: sr.ports, vulns: sr.vulns });
          devices.push({
            ip: sr.ip, ports: sr.ports, hostnames: sr.hostnames,
            cpes: sr.cpes, vulns: sr.vulns, tags: sr.tags,
            device_type: classification.device_type,
            device_icon: classification.device_icon,
            device_color: classification.device_color,
            risk_level: risk
          });
          deviceBreakdown[classification.device_type] = (deviceBreakdown[classification.device_type] || 0) + 1;
        }

        setSweepResult({
          center: initData.center,
          subnet: `${subnet}/${cidr}`,
          cidr,
          target_ip: initData.target_ip,
          devices,
          summary: { total_hosts: totalHosts, total_responsive: devices.length, device_breakdown: deviceBreakdown },
          sweep_time_ms: Date.now() - t0
        });
        setSweepProgress(null);
        setHistory(prev => [{ tab: activeTab, query, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
      } catch (err: any) {
        setError(err.message);
        setSweepProgress(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      let url = '';
      switch (activeTab) {

        case 'dns': url = `/api/osint/dns?domain=${encodeURIComponent(query)}`; break;
        case 'certs': url = `/api/osint/certs?domain=${encodeURIComponent(query)}`; break;
        case 'whois': url = `/api/osint/whois?domain=${encodeURIComponent(query)}`; break;
        case 'threats': url = `/api/osint/threats?query=${encodeURIComponent(query)}`; break;
        case 'bgp': url = `/api/osint/bgp?query=${encodeURIComponent(query)}`; break;
        case 'mac': url = `/api/osint/mac?mac=${encodeURIComponent(query)}`; break;
        case 'phone': url = `/api/osint/phone?number=${encodeURIComponent(query)}`; break;
        case 'leaks': url = `https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(query)}`; break;
        case 'crypto': url = `/api/osint/crypto?address=${encodeURIComponent(query)}`; break;
        case 'github': url = `/api/osint/github?user=${encodeURIComponent(query)}`; break;
        case 'headers': url = `/api/osint/certs?domain=${encodeURIComponent(query)}`; break;
        case 'ssl': url = `/api/osint/certs?domain=${encodeURIComponent(query)}`; break;
        case 'subdomains': url = `/api/osint/dns?domain=${encodeURIComponent(query)}&type=subdomains`; break;
        case 'tech': url = `/api/osint/ip?ip=${encodeURIComponent(query)}`; break;
        case 'sec-edgar': url = `/api/sec-edgar?q=${encodeURIComponent(query)}`; break;
        case 'gleif': url = `/api/gleif?${query.match(/^[A-Z0-9]{20}$/) ? 'lei' : 'name'}=${encodeURIComponent(query)}`; break;
        case 'reviews': url = `/api/reviews?entity=${encodeURIComponent(query)}`; break;
        case 'social': {
          // Detect if query looks like a LinkedIn URL for direct-profile path
          const isUrl = query.startsWith('http');
          const socialType = (query.toLowerCase().includes('company') || query.toLowerCase().includes('/company/')) ? 'company' : 'person';
          url = isUrl
            ? `/api/social?type=${socialType}&url=${encodeURIComponent(query)}`
            : `/api/social?type=${socialType}&query=${encodeURIComponent(query)}`;
          break;
        }
        case 'shodan': url = `https://internetdb.shodan.io/${encodeURIComponent(query)}`; break;
      }
      const res = await fetch(url, activeTab === 'shodan' ? { cache: 'no-store' } : undefined);
      if (activeTab === 'shodan' && res.status === 404) {
        setResults({ ip: query, status: 'No Shodan InternetDB records found', ports: [], cpes: [], hostnames: [], tags: [], vulns: [] });
        setLoading(false);
        return;
      }
      if (activeTab === 'leaks' && res.status === 404) {
        setResults({ email: query, breached: false, breaches: [], data_exposed: [] });
        setHistory(prev => [{ tab: activeTab, query, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (res.ok) {
        let parsedData = data;
        if (activeTab === 'leaks') {
           let breachList: string[] = [];
           const dataExposed = new Set<string>();
           if (data.BreachesSummary && data.BreachesSummary.site) {
              breachList = data.BreachesSummary.site.split(';').filter(Boolean);
           }
           if (data.ExposedData && Array.isArray(data.ExposedData)) {
              data.ExposedData.forEach((item: any) => {
                 if (item.data_classes && Array.isArray(item.data_classes)) {
                    item.data_classes.forEach((dc: string) => dataExposed.add(dc));
                 }
              });
           }
           parsedData = {
              email: query,
              breached: breachList.length > 0,
              breaches: breachList,
              data_exposed: Array.from(dataExposed).sort()
           };
        }

        setResults(parsedData);
        setHistory(prev => [{ tab: activeTab, query, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
        
        // Geolocate the target in the background
        if (activeTab === 'phone') {
          if (data.lat && data.lng && onScanGeolocate) {
             onScanGeolocate(query, { lat: data.lat, lng: data.lng, type: 'phone', region: data.region });
          }
        } else if (activeTab !== 'sweep' && activeTab !== 'crypto' && activeTab !== 'mac' && activeTab !== 'bgp' && activeTab !== 'github' && activeTab !== 'leaks' && activeTab !== 'phone') {
          fetch(`/api/osint/ip?ip=${encodeURIComponent(query)}`)
            .then(r => r.json())
            .then(locData => {
              if (locData && locData.geo && locData.geo.lat && locData.geo.lon && onScanGeolocate) {
                // ip-api returns lat/lon, we pass it up
                onScanGeolocate(query, { lat: locData.geo.lat, lng: locData.geo.lon, ...locData, type: activeTab });
              }
            })
            .catch(() => {});
        }
      } else {
        setError(data.error || 'Lookup failed');
      }
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [query, activeTab, scanType, loading, sweepCidr]);

  const currentTab = TABS.find(t => t.id === activeTab);

  // ── Shodan-style structured result renderers ──

  const ResultRow = ({ label, value, color, mono = true }: { label: string; value: any; color?: string; mono?: boolean }) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <div className="flex items-start gap-3 py-1.5 border-b border-[var(--border-secondary)]/20 last:border-0">
        <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider w-[90px] flex-shrink-0 pt-0.5">{label}</span>
        <span className={`text-[10px] ${mono ? 'font-mono' : ''} break-all flex-1`} style={{ color: color || 'var(--text-primary)' }}>
          {String(value)}
        </span>
      </div>
    );
  };

  const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono font-bold ${ok ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
      {ok ? <CheckCircle className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
      {label}
    </span>
  );

  // Surfaces an inline OFAC-SDN hit (used by the WHOIS and IP-intel routes
  // when their cross-check finds a sanctioned registrant / ASN owner).
  const SanctionsBadge = ({ match }: { match: any }) => {
    if (!match || !Array.isArray(match.hits) || match.hits.length === 0) return null;
    return (
      <div className="mb-2 px-2 py-2 rounded border border-red-500/40 bg-red-500/15">
        <div className="flex items-center gap-2 mb-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          <span className="text-[10px] font-mono font-bold text-red-400 tracking-wider">
            SANCTIONED — {match.source || 'OFAC SDN'}
          </span>
        </div>
        {match.hits.slice(0, 5).map((h: any, i: number) => (
          <div key={i} className="text-[9px] font-mono text-red-200 break-all leading-tight">
            <span className="text-[var(--text-muted)]">↳ {h.matched_value}:</span>{' '}
            {(h.entries || []).slice(0, 2).map((e: any) => e.name).join('; ')}
          </div>
        ))}
      </div>
    );
  };

  const SectionHeader = ({ title, icon: Icon, color }: { title: string; icon: any; color: string }) => (
    <div className="flex items-center gap-2 mt-3 mb-1.5 first:mt-0">
      <Icon className="w-3.5 h-3.5" style={{ color }} />
      <span className="text-[10px] font-mono font-bold tracking-widest" style={{ color }}>{title}</span>
      <div className="flex-1 h-px" style={{ background: `${color}30` }} />
    </div>
  );

  const PortRow = ({ port, state, service, version }: { port: number; state: string; service?: string; version?: string }) => (
    <div className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[var(--hover-accent)] transition-colors">
      <span className="text-[11px] font-mono font-bold text-[var(--cyan-primary)] w-[60px]">{port}</span>
      <StatusBadge ok={state === 'open'} label={state.toUpperCase()} />
      <span className="text-[10px] font-mono text-[var(--text-secondary)] flex-1">{service || 'unknown'}</span>
      {version && <span className="text-[9px] font-mono text-[var(--text-muted)]">{version}</span>}
    </div>
  );

  const renderStructuredResults = () => {
    if (!results) return null;
    const r = results;

    // ── DNS ──
    if (activeTab === 'dns') {
      return (
        <div>
          <SectionHeader title="DNS RECORDS" icon={Server} color="#448AFF" />
          <ResultRow label="Domain" value={r.domain || query} color="#448AFF" />
          {r.A && <ResultRow label="A Records" value={Array.isArray(r.A) ? r.A.join(', ') : r.A} />}
          {r.AAAA && <ResultRow label="AAAA" value={Array.isArray(r.AAAA) ? r.AAAA.join(', ') : r.AAAA} />}
          {r.MX && <ResultRow label="MX" value={Array.isArray(r.MX) ? r.MX.map((m:any) => m.exchange || m).join(', ') : r.MX} />}
          {r.NS && <ResultRow label="NS" value={Array.isArray(r.NS) ? r.NS.join(', ') : r.NS} />}
          {r.TXT && <ResultRow label="TXT" value={Array.isArray(r.TXT) ? r.TXT.join(' | ') : r.TXT} />}
          {r.CNAME && <ResultRow label="CNAME" value={Array.isArray(r.CNAME) ? r.CNAME.join(', ') : r.CNAME} />}
          {r.SOA && <ResultRow label="SOA" value={typeof r.SOA === 'object' ? `${r.SOA.nsname} (${r.SOA.hostmaster})` : r.SOA} />}
          {renderFallbackExcluding(['domain','A','AAAA','MX','NS','TXT','CNAME','SOA','timestamp','cached'])}
        </div>
      );
    }

    // ── WHOIS ──
    if (activeTab === 'whois') {
      return (
        <div>
          <SectionHeader title="WHOIS INTELLIGENCE" icon={FileText} color="#FFD700" />
          <SanctionsBadge match={r.sanctions_match} />
          <ResultRow label="Domain" value={r.domain_name || r.domainName || query} color="#FFD700" />
          <ResultRow label="Registrar" value={r.registrar} />
          <ResultRow label="Created" value={r.creation_date || r.createdDate} />
          <ResultRow label="Expires" value={r.expiration_date || r.expiresDate} />
          <ResultRow label="Updated" value={r.updated_date || r.updatedDate} />
          <ResultRow label="Status" value={Array.isArray(r.status) ? r.status.join(', ') : r.status} />
          <ResultRow label="Nameservers" value={Array.isArray(r.name_servers || r.nameServers) ? (r.name_servers || r.nameServers).join(', ') : r.name_servers} />
          {renderFallbackExcluding(['domain_name','domainName','registrar','creation_date','createdDate','expiration_date','expiresDate','updated_date','updatedDate','status','name_servers','nameServers','timestamp','cached','raw','sanctions_match'])}
        </div>
      );
    }

    // ── SHODAN ──
    if (activeTab === 'shodan') {
      return (
        <div>
          <SectionHeader title="SHODAN IOT INTELLIGENCE" icon={Network} color="#FF3D3D" />
          <ResultRow label="Target IP" value={r.ip || query} color="#FF3D3D" />
          {r.hostnames?.length > 0 && <ResultRow label="Hostnames" value={r.hostnames.join(', ')} />}
          {r.ports?.length > 0 && <ResultRow label="Open Ports" value={r.ports.join(', ')} color="#00E5FF" />}
          {r.tags?.length > 0 && <ResultRow label="Tags" value={r.tags.join(', ')} color="#FF9500" />}
          {r.vulns?.length > 0 && (
            <div className="mt-2 p-2 border border-red-500/30 bg-red-500/10 rounded">
              <span className="text-[10px] font-mono text-red-400 font-bold mb-1 block">VULNERABILITIES ({r.vulns.length})</span>
              <div className="flex flex-wrap gap-1">
                {r.vulns.slice(0, 10).map((v: string) => (
                  <a key={v} href={`https://nvd.nist.gov/vuln/detail/${v}`} target="_blank" rel="noreferrer" className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#1A1A18] text-[#8A8880] hover:text-[#FF3D3D]">{v}</a>
                ))}
                {r.vulns.length > 10 && <span className="text-[9px] font-mono text-[#8A8880]">+{r.vulns.length - 10} more</span>}
              </div>
            </div>
          )}
          {renderFallbackExcluding(['ip','hostnames','ports','tags','vulns','cpes'])}
        </div>
      );
    }

    // ── BGP ──
    if (activeTab === 'bgp') {
      return (
        <div>
          <SectionHeader title="BGP ROUTING INTELLIGENCE" icon={Globe} color="#00E5FF" />
          <ResultRow label="Query" value={r.query} color="#00E5FF" />
          {r.type === 'ip' && r.ip && (
            <>
              {r.ip.prefixes?.map((p: any, i: number) => (
                <div key={i} className="mt-2 p-2 border border-[#00E5FF]/20 bg-[#00E5FF]/5 rounded">
                  <ResultRow label="ASN" value={`AS${p.asn.asn} - ${p.asn.name}`} color="#00E5FF" />
                  <ResultRow label="Prefix" value={p.prefix} />
                  <ResultRow label="Country" value={p.asn.country_code} />
                  <ResultRow label="Description" value={p.asn.description} />
                </div>
              ))}
            </>
          )}
          {r.type === 'asn' && r.asn && (
            <div className="mt-2 p-2 border border-[#00E5FF]/20 bg-[#00E5FF]/5 rounded">
              <ResultRow label="ASN" value={`AS${r.asn.asn}`} color="#00E5FF" />
              <ResultRow label="Name" value={r.asn.name} />
              <ResultRow label="Description" value={r.asn.description} />
              <ResultRow label="Country" value={r.asn.country_code} />
              {r.prefixes && <ResultRow label="Prefixes" value={`IPv4: ${r.prefixes.total_v4} | IPv6: ${r.prefixes.total_v6}`} />}
              {r.peers && <ResultRow label="Peers" value={r.peers.total} />}
            </div>
          )}
          {renderFallbackExcluding(['query', 'type', 'ip', 'asn', 'prefixes', 'peers', 'timestamp'])}
        </div>
      );
    }

    // ── MAC ──
    if (activeTab === 'mac') {
      return (
        <div>
          <SectionHeader title="MAC VENDOR LOOKUP" icon={Fingerprint} color="#FFD700" />
          <ResultRow label="MAC Address" value={r.mac} color="#FFD700" />
          <ResultRow label="Vendor" value={r.vendor} color={r.vendor === 'Not Found' ? '#FF3D3D' : '#00E676'} />
        </div>
      );
    }

    // ── PHONE ──
    if (activeTab === 'phone') {
      return (
        <div>
          <SectionHeader title="PHONE INTELLIGENCE" icon={Phone} color="#FF9500" />
          <ResultRow label="Query" value={r.query} color="#FF9500" />
          <ResultRow label="Valid" value={r.valid ? 'YES' : 'NO'} color={r.valid ? '#00E676' : '#FF3D3D'} />
          {r.valid && (
            <>
              <ResultRow label="E.164 Format" value={r.number} />
              <ResultRow label="Intl Format" value={r.international} />
              <ResultRow label="Nat Format" value={r.national} />
              <ResultRow label="Country" value={`${r.region} (${r.country_code})`} />
              <ResultRow label="Line Type" value={r.line_type} color={r.line_type === 'MOBILE' ? '#00E5FF' : r.line_type === 'VOIP' ? '#FF9500' : undefined} />
            </>
          )}
        </div>
      );
    }

    // ── GITHUB ──
    if (activeTab === 'github') {
      return (
        <div>
          <SectionHeader title="GITHUB RECON" icon={Terminal} color="#87CEEB" />
          <div className="flex items-center gap-3 mb-2">
            {r.avatar_url && <img src={r.avatar_url} alt="avatar" className="w-10 h-10 rounded-full border border-[#87CEEB]/30" />}
            <div>
              <div className="text-[12px] font-mono font-bold text-[#87CEEB]">{r.name || r.username}</div>
              <div className="text-[9px] font-mono text-[var(--text-muted)]">@{r.username} • {r.followers} followers</div>
            </div>
          </div>
          <ResultRow label="Company" value={r.company} />
          <ResultRow label="Location" value={r.location} />
          <ResultRow label="Email" value={r.email} color="#00E676" />
          <ResultRow label="Twitter" value={r.twitter} color="#448AFF" />
          <ResultRow label="Website" value={r.blog} />
          <ResultRow label="Bio" value={r.bio} />
          {r.recent_repos?.length > 0 && (
            <div className="mt-2 p-2 border border-[#87CEEB]/20 bg-[#87CEEB]/5 rounded">
              <span className="text-[9px] font-mono text-[#87CEEB] block mb-1">RECENT REPOS</span>
              {r.recent_repos.map((repo: any, i: number) => (
                <div key={i} className="flex justify-between text-[9px] font-mono mb-0.5">
                  <span className="text-[#E8E6E0]">{repo.name}</span>
                  <span className="text-[var(--text-muted)]">{repo.language || 'Unknown'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── LEAKS ──
    if (activeTab === 'leaks') {
      return (
        <div>
          <SectionHeader title="DATA LEAK SWEEP" icon={ShieldAlert} color="#E040FB" />
          <ResultRow label="Email Target" value={r.email} color="#E040FB" />
          <ResultRow label="Status" value={r.breached ? 'COMPROMISED' : 'SECURE'} color={r.breached ? '#FF1744' : '#00E676'} />
          
          {r.breached && r.data_exposed?.length > 0 && (
            <div className="mt-2 p-2 border border-[#E040FB]/30 bg-[#E040FB]/10 rounded">
              <span className="text-[10px] font-mono text-[#E040FB] font-bold mb-1 block">EXPOSED DATA POINTS</span>
              <div className="flex flex-wrap gap-1">
                {r.data_exposed.map((dc: string) => (
                  <span key={dc} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#1A1A18] text-[#E8E6E0] border border-[#E040FB]/20">{dc}</span>
                ))}
              </div>
            </div>
          )}

          {r.breached && r.breaches?.length > 0 && (
            <div className="mt-2 p-2 border border-red-500/30 bg-red-500/10 rounded">
              <span className="text-[10px] font-mono text-red-400 font-bold mb-1 block">KNOWN BREACHES ({r.breaches.length})</span>
              <div className="flex flex-col gap-1">
                {r.breaches.map((b: string) => (
                  <a key={b} href={`https://haveibeenpwned.com/PwnedWebsites#${b}`} target="_blank" rel="noreferrer" className="text-[9px] font-mono px-2 py-1 rounded bg-[#1A1A18] text-red-300 hover:text-white hover:bg-red-500/30 flex items-center justify-between transition-colors">
                    <span>{b}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── CERTS ──
    if (activeTab === 'certs') {
      const certs = r.certificates || r.certs || (Array.isArray(r) ? r : []);
      return (
        <div>
          <SectionHeader title="CERTIFICATE TRANSPARENCY" icon={Lock} color="#E040FB" />
          <ResultRow label="Domain" value={query} color="#E040FB" />
          <ResultRow label="Certificates" value={Array.isArray(certs) ? certs.length : 0} />
          {Array.isArray(certs) && certs.slice(0, 15).map((c: any, i: number) => (
            <div key={i} className="mt-1.5 p-2 rounded border border-[var(--border-secondary)]/30 bg-[var(--bg-tertiary)]/30">
              <ResultRow label="Issuer" value={c.issuer_name || c.issuer} />
              <ResultRow label="Common Name" value={c.common_name || c.name_value} />
              <ResultRow label="Not Before" value={c.not_before} />
              <ResultRow label="Not After" value={c.not_after} />
            </div>
          ))}
          {(!Array.isArray(certs) || certs.length === 0) && renderFallback()}
        </div>
      );
    }

    // ── THREATS ──
    if (activeTab === 'threats') {
      return (
        <div>
          <SectionHeader title="THREAT INTELLIGENCE" icon={AlertTriangle} color="#FF9500" />
          <ResultRow label="Query" value={query} color="#FF9500" />
          <ResultRow label="Risk Score" value={r.risk_score || r.score} color={
            (r.risk_score || r.score || 0) > 70 ? '#FF3D3D' : (r.risk_score || r.score || 0) > 40 ? '#FF9500' : '#00E676'
          } />
          <ResultRow label="Malicious" value={r.malicious !== undefined ? (r.malicious ? 'YES' : 'NO') : undefined} color={r.malicious ? '#FF3D3D' : '#00E676'} />
          <ResultRow label="Category" value={r.category || r.type} />
          <ResultRow label="Reports" value={r.total_reports || r.reports} />
          <ResultRow label="Last Seen" value={r.last_seen || r.last_analysis} />
          {r.tags && <ResultRow label="Tags" value={Array.isArray(r.tags) ? r.tags.join(', ') : r.tags} />}
          {renderFallbackExcluding(['risk_score','score','malicious','category','type','total_reports','reports','last_seen','last_analysis','tags','timestamp','cached','query'])}
        </div>
      );
    }

    // ── SSL ──
    if (activeTab === 'ssl') {
      return (
        <div>
          <SectionHeader title="SSL/TLS ANALYSIS" icon={Shield} color="#76FF03" />
          <ResultRow label="Target" value={query} color="#76FF03" />
          <ResultRow label="Protocol" value={r.protocol || r.tls_version} />
          <ResultRow label="Cipher" value={r.cipher || r.cipher_suite} />
          <ResultRow label="Valid" value={r.valid !== undefined ? (r.valid ? 'YES' : 'NO') : undefined} color={r.valid ? '#00E676' : '#FF3D3D'} />
          <ResultRow label="Issuer" value={r.issuer} />
          <ResultRow label="Subject" value={r.subject} />
          <ResultRow label="Expires" value={r.expires || r.not_after} />
          <ResultRow label="SANs" value={Array.isArray(r.sans) ? r.sans.join(', ') : r.sans} />
          {renderFallback()}
        </div>
      );
    }



    // ── SEC EDGAR ──
    if (activeTab === 'sec-edgar') {
      const filings: any[] = Array.isArray(r.filings) ? r.filings : [];
      const total: number = typeof r.total === 'number' ? r.total : filings.length;
      return (
        <div>
          <SectionHeader title="SEC EDGAR FILINGS" icon={BookOpen} color="#00C853" />
          <ResultRow label="Query" value={r.query || query} color="#00C853" />
          <ResultRow label="Total Found" value={total > 0 ? String(total) : 'No filings found'} color={total > 0 ? '#00C853' : 'var(--text-muted)'} />
          {filings.length === 0 && (
            <div className="text-[10px] font-mono text-[var(--text-muted)] py-2">No filings matched. Try a different company name or keyword.</div>
          )}
          {filings.map((f: any, i: number) => (
            <div key={i} className="mt-2 p-2 rounded border border-[#00C853]/15 bg-[#00C853]/5 space-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-mono font-bold text-[#00C853] truncate flex-1">{f.company}</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#00C853]/20 text-[#00C853] border border-[#00C853]/30 flex-shrink-0">{f.form}</span>
              </div>
              {f.filedDate && <div className="text-[9px] font-mono text-[var(--text-muted)]">Filed: {f.filedDate}</div>}
              {f.title && f.title !== f.form && <div className="text-[9px] font-mono text-[var(--text-secondary)]">{f.title}</div>}
              {f.cik && <div className="text-[9px] font-mono text-[var(--text-muted)]">File: {f.cik}</div>}
              {f.url && (
                <a href={f.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[9px] font-mono text-[#00C853] hover:underline mt-0.5">
                  <ExternalLink className="w-2.5 h-2.5" /> View on EDGAR
                </a>
              )}
            </div>
          ))}
        </div>
      );
    }

    // ── GLEIF LEI ──
    if (activeTab === 'gleif') {
      const entities: any[] = Array.isArray(r.entities) ? r.entities : [];
      return (
        <div>
          <SectionHeader title="GLEIF LEGAL ENTITY LOOKUP" icon={IdCard} color="#D4AF37" />
          <ResultRow label="Query" value={r.query || query} color="#D4AF37" />
          <ResultRow label="Matches" value={entities.length > 0 ? String(entities.length) : 'No entities found'} color={entities.length > 0 ? '#D4AF37' : 'var(--text-muted)'} />
          {entities.length === 0 && (
            <div className="text-[10px] font-mono text-[var(--text-muted)] py-2">No LEI records matched. Try the full legal name or a 20-character LEI code.</div>
          )}
          {entities.map((e: any, i: number) => (
            <div key={i} className="mt-2 p-2 rounded border border-[#D4AF37]/15 bg-[#D4AF37]/5 space-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-mono font-bold text-[#D4AF37] flex-1 leading-tight">{e.name}</span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 ${e.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
                  {e.status || 'UNKNOWN'}
                </span>
              </div>
              <div className="text-[9px] font-mono text-[var(--cyan-primary)] tracking-wider">{e.lei}</div>
              {e.jurisdiction && <ResultRow label="Jurisdiction" value={e.jurisdiction} />}
              {e.hq?.country && <ResultRow label="HQ" value={[e.hq.city, e.hq.country].filter(Boolean).join(', ')} />}
              {e.parentLei && <ResultRow label="Parent LEI" value={e.parentLei} />}
              <a href={`https://search.gleif.org/#/record/${e.lei}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-[9px] font-mono text-[#D4AF37] hover:underline mt-0.5">
                <ExternalLink className="w-2.5 h-2.5" /> View on GLEIF
              </a>
            </div>
          ))}
        </div>
      );
    }

    // ── REVIEWS & SENTIMENT ──
    if (activeTab === 'reviews') {
      if (!results) return null;
      const { reviews = [], aggregate = {}, provider = '', _note = '' } = results as any;
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Star className="w-3.5 h-3.5" style={{ color: '#FF6B35' }} />
            <span className="hud-text text-[11px] font-bold" style={{ color: '#FF6B35' }}>REVIEWS &amp; SENTIMENT</span>
            {provider && <span className="gotham-tag gotham-tag--low text-[7px] px-1 uppercase">{provider}</span>}
          </div>
          {aggregate?.score > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="text-[10px] font-mono text-[var(--text-muted)]">PROVIDER SCORE</span>
              <span className="text-[14px] font-mono font-bold" style={{ color: '#FF6B35' }}>{aggregate.score.toFixed(1)}/5</span>
              <span className="text-[9px] font-mono text-[var(--text-muted)]">({aggregate.count?.toLocaleString()} reviews · {aggregate.platform})</span>
            </div>
          )}
          {_note && (
            <div className="text-[8px] font-mono text-[var(--text-muted)] italic px-1">
              {_note}
            </div>
          )}
          {reviews.length === 0 && (
            <div className="text-[10px] font-mono text-[var(--text-muted)] py-2">No reviews returned. Try an App Store ID (numeric) or brand name with a keyed provider.</div>
          )}
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {reviews.map((r: any, i: number) => (
              <div key={i} className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono font-bold text-[var(--text-primary)]">{r.author}</span>
                  <div className="flex items-center gap-1">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} className="w-2.5 h-2.5" style={{ color: s <= r.rating ? '#FF6B35' : 'var(--text-muted)', fill: s <= r.rating ? '#FF6B35' : 'transparent' }} />
                    ))}
                  </div>
                </div>
                <p className="text-[9px] font-mono text-[var(--text-secondary)] leading-relaxed line-clamp-3">{r.text}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-[var(--text-muted)]">{r.platform} · {r.date?.slice(0,10)}</span>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[8px] font-mono text-[#FF6B35] hover:underline">
                      <ExternalLink className="w-2.5 h-2.5" /> View
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[7px] font-mono text-[var(--text-muted)] italic px-1 mt-1">
            Sentiment scoring handled by Kammandor — raw provider data only.
          </div>
        </div>
      );
    }

    // ── SOCIAL & PEOPLE ──
    // Raw provider data — scored in Kammandor; personal data — see GDPR note.
    if (activeTab === 'social') {
      if (!results) return null;
      const { profiles = [], provider = '' } = results as any;
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-3.5 h-3.5" style={{ color: '#0077B5' }} />
            <span className="hud-text text-[11px] font-bold" style={{ color: '#0077B5' }}>SOCIAL &amp; PEOPLE</span>
            {provider && <span className="gotham-tag gotham-tag--low text-[7px] px-1 uppercase">{provider}</span>}
          </div>
          <div className="text-[7px] font-mono text-[var(--text-muted)] italic px-1 mb-2 border border-[#0077B530] rounded p-1 bg-[var(--bg-secondary)]">
            Raw provider data · Scored in Kammandor · Personal data — GDPR sign-off required before production use.
          </div>
          {profiles.length === 0 && (
            <div className="text-[10px] font-mono text-[var(--text-muted)] py-2">
              No profiles returned. Check BRIGHTDATA_API_TOKEN and BRIGHTDATA_DS_LI_* env vars are configured.
            </div>
          )}
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {profiles.map((p: any, i: number) => (
              <div key={i} className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-bold text-[var(--text-primary)] truncate">{p.name}</span>
                  <span className="text-[7px] font-mono text-[#0077B5] uppercase flex-shrink-0">{p.type}</span>
                </div>
                {p.headline && (
                  <p className="text-[8px] font-mono text-[var(--text-secondary)] leading-relaxed line-clamp-2">{p.headline}</p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  {p.location && <span className="text-[8px] font-mono text-[var(--text-muted)]">{p.location}</span>}
                  {typeof p.followers === 'number' && (
                    <span className="text-[8px] font-mono text-[var(--text-muted)]">{p.followers.toLocaleString()} followers</span>
                  )}
                  {typeof p.employees === 'number' && (
                    <span className="text-[8px] font-mono text-[var(--text-muted)]">{p.employees.toLocaleString()} employees</span>
                  )}
                </div>
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[8px] font-mono text-[#0077B5] hover:underline">
                    <ExternalLink className="w-2.5 h-2.5" /> LinkedIn
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Fallback for other tools
    return renderFallback();
  };

  const renderFallback = () => {
    if (!results) return null;
    return (
      <div className="space-y-1">
        {Object.entries(results).filter(([k]) => !['timestamp','cached'].includes(k)).map(([key, value]) => (
          <ResultRow key={key} label={key.replace(/_/g, ' ')} value={typeof value === 'object' ? JSON.stringify(value, null, 1) : String(value)} />
        ))}
      </div>
    );
  };

  const renderFallbackExcluding = (exclude: string[]) => {
    if (!results) return null;
    const extra = Object.entries(results).filter(([k]) => !exclude.includes(k));
    if (extra.length === 0) return null;
    return (
      <div className="mt-2 space-y-1">
        {extra.map(([key, value]) => (
          <ResultRow key={key} label={key.replace(/_/g, ' ')} value={typeof value === 'object' ? JSON.stringify(value, null, 1) : String(value)} />
        ))}
      </div>
    );
  };

  const renderContent = () => (
    <div className="flex flex-col gap-2.5">
      {/* Tool Grid */}
      <div className="flex flex-col gap-1">
        {/* Sweep & Self Track Actions */}
        <div className="grid grid-cols-2 gap-2">
          {FLAGS.activeReconEnabled && (
            <button onClick={() => { setActiveTab('sweep'); setQuery(''); setResults(null); setError(''); }}
                className={`w-full py-4 rounded-lg border flex flex-col items-center justify-center gap-2 transition-all ${
                  activeTab === 'sweep' ? 'bg-[var(--bg-tertiary)] border-opacity-50' : 'bg-[#0D0D0C] hover:bg-[var(--hover-accent)] border-transparent'
                }`}
                style={{ borderColor: activeTab === 'sweep' ? '#FF3D3D' : 'rgba(255, 61, 61, 0.2)' }}
              >
                <div className="flex items-center gap-3">
                  <Crosshair className="w-5 h-5" style={{ color: '#FF3D3D' }} />
                  <span className="font-mono font-bold tracking-[0.1em] text-[11px]" style={{ color: '#FF3D3D' }}>GLOBAL SWEEP</span>
                </div>
            </button>
          )}
          <button onClick={handleSelfTrack}
            disabled={loading}
            className={`w-full py-4 rounded-lg border flex flex-col items-center justify-center gap-2 transition-all ${loading ? 'opacity-60 cursor-wait' : 'hover:bg-[var(--hover-accent)] hover:shadow-[0_0_20px_rgba(0,230,118,0.15)]'} bg-[#0D0D0C]`}
            style={{ borderColor: 'rgba(0, 230, 118, 0.2)' }}
          >
            <div className="flex items-center gap-3">
              <LocateFixed className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} style={{ color: '#00E676' }} />
              <span className="font-mono font-bold tracking-[0.1em] text-[11px]" style={{ color: '#00E676' }}>{loading ? 'TRACKING...' : 'SELF TRACK'}</span>
            </div>
          </button>
        </div>
        {/* Other Tools */}
        <div className="grid grid-cols-5 gap-1 mt-1">
          {TABS.filter(t => t.id !== 'sweep' && (FLAGS.activeReconEnabled || !ACTIVE_RECON_TAB_IDS.has(t.id))).map(tab => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setQuery(''); setResults(null); setError(''); }}
              className={`flex flex-col items-center gap-1 px-1 py-2 rounded-lg text-[8px] font-mono tracking-wider transition-all border ${activeTab === tab.id ? 'border-opacity-40 bg-opacity-15' : 'border-transparent hover:bg-[var(--hover-accent)]'}`}
              style={{ borderColor: activeTab === tab.id ? tab.color : 'transparent', backgroundColor: activeTab === tab.id ? `${tab.color}15` : undefined, color: activeTab === tab.id ? tab.color : 'var(--text-muted)' }}>
              <tab.icon className="w-3.5 h-3.5" />
              <span className="leading-none text-center truncate w-full">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input Area */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runLookup()}
              placeholder={currentTab?.placeholder}
              className="w-full bg-[var(--bg-primary)]/60 border border-[var(--border-primary)] rounded-lg pl-8 pr-3 py-2.5 text-[11px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/40 focus:outline-none transition-colors"
              style={{ borderColor: query ? `${currentTab?.color}40` : undefined }} />
          </div>
          <button onClick={runLookup} disabled={loading || !query.trim()}
            className="px-4 py-2 rounded-lg text-[10px] font-mono font-bold tracking-wider disabled:opacity-30 transition-all flex items-center justify-center min-w-[70px]"
            style={{ backgroundColor: `${currentTab?.color}20`, border: `1px solid ${currentTab?.color}40`, color: currentTab?.color }}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'SCAN'}
          </button>
        </div>
        
        {/* Secondary Controls */}
        {(activeTab === 'sweep') && (
          <div className="flex items-center justify-between bg-[var(--bg-primary)]/60 border border-[var(--border-primary)] rounded-lg p-1">
            <span className="text-[9px] font-mono text-[var(--text-muted)] pl-2">SUBNET MASK:</span>
            <div className="flex items-center gap-0.5">
              {[24, 25, 26, 27, 28].map(c => (
                <button key={c} onClick={() => setSweepCidr(c)}
                  className={`px-2 py-1 text-[10px] font-mono rounded transition-all ${
                    sweepCidr === c ? 'bg-[#FF3D3D]/20 text-[#FF3D3D]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                  }`}
                >/{c}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-[11px] font-mono text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}
        </div>
      )}

      {/* Sweep Progress */}
      {sweepProgress && loading && (
        <div className="p-3 rounded-lg border border-[#FF3D3D]/30 bg-[#FF3D3D]/5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono tracking-wider text-[#FF3D3D]">SWEEPING SUBNET...</span>
            <span className="text-[10px] font-mono text-[#E8E6E0]">{sweepProgress.total} hosts</span>
          </div>
          <div className="w-full h-1.5 bg-[#1A1A18] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: '100%', background: 'linear-gradient(90deg, #FF3D3D, #FF6B00, #FFD700)', animation: 'sweep-pulse 1.5s ease-in-out infinite' }} />
          </div>
        </div>
      )}

      {/* Sweep Results */}
      {sweepResult && !loading && (
        <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-primary)] rounded-lg overflow-hidden max-h-[55vh] overflow-y-auto styled-scrollbar">
          {/* Summary */}
          <div className="p-3 border-b border-[#2A2A28]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[11px] font-mono tracking-wider text-[#E8E6E0]">{sweepResult.subnet}</div>
                <div className="text-[9px] font-mono text-[#5C5A54]">{sweepResult.center.city}, {sweepResult.center.country} · {sweepResult.center.isp}</div>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-mono font-bold text-[#FF3D3D]">{sweepResult.summary.total_responsive}</div>
                <div className="text-[8px] font-mono text-[#5C5A54] tracking-wider">DEVICES FOUND</div>
              </div>
            </div>
            {/* Breakdown Bar */}
            <div className="flex h-2 rounded-full overflow-hidden bg-[#1A1A18] mb-2">
              {Object.entries(sweepResult.summary.device_breakdown).map(([type, count]: [string, any]) => {
                const device = sweepResult.devices.find((d: any) => d.device_type === type);
                return <div key={type} style={{ width: `${(count / sweepResult.summary.total_responsive) * 100}%`, backgroundColor: device?.device_color || '#666' }} title={`${type}: ${count}`} />;
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(sweepResult.summary.device_breakdown).map(([type, count]: [string, any]) => {
                const device = sweepResult.devices.find((d: any) => d.device_type === type);
                return (
                  <div key={type} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: device?.device_color || '#666' }} />
                    <span className="text-[9px] font-mono text-[#8A8880]">{type}</span>
                    <span className="text-[9px] font-mono text-[#E8E6E0] font-bold">{String(count)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Visualize Button */}
          <div className="p-3 border-b border-[#2A2A28]">
            <button onClick={() => onSweepVisualize?.(sweepResult)}
              className="w-full py-2.5 rounded-lg font-mono text-[11px] tracking-wider font-bold transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, rgba(255,61,61,0.2), rgba(255,107,0,0.2))', border: '1px solid rgba(255,61,61,0.5)', color: '#FF3D3D', textShadow: '0 0 10px rgba(255,61,61,0.5)' }}
            >
              <Globe className="w-4 h-4" /> VISUALIZE ON GLOBE
            </button>
          </div>
          {/* Device List */}
          <div className={isFullScreen ? "flex flex-col gap-3 p-4" : "divide-y divide-[#2A2A28]"}>
            {sweepResult.devices.map((device: any) => {
              const isExpanded = expandedDevice === device.ip;
              return (
              <div key={device.ip} className={isFullScreen
                ? "bg-[#0D0D0C] border border-[#2A2A28] rounded-lg overflow-hidden hover:border-[#3A3A38] transition-colors"
                : "px-3 py-2.5 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
              }>
                {/* Device Header */}
                <div
                  className={isFullScreen
                    ? "flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#151514] transition-colors"
                    : "flex items-center justify-between mb-1"
                  }
                  onClick={() => {
                    if (!isFullScreen) return;
                    const next = isExpanded ? null : device.ip;
                    setExpandedDevice(next);
                    if (next && device.vulns.length > 0) fetchCveDetails(device.vulns);
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: device.device_color }} />
                    <span className={`flex-shrink-0 ${isFullScreen ? "text-[14px]" : "text-[11px]"} font-mono font-bold text-[#E8E6E0]`}>{device.ip}</span>
                    {device.hostnames.length > 0 && (
                      <span className={`${isFullScreen ? "text-[11px]" : "text-[9px]"} font-mono text-[#5C5A54] truncate min-w-0`}>{device.hostnames[0]}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {device.vulns.length > 0 && (
                      <span className={`${isFullScreen ? "text-[10px]" : "text-[8px]"} font-mono px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 whitespace-nowrap`}>
                        {device.vulns.length} CVEs
                      </span>
                    )}
                    <span className={`${isFullScreen ? "text-[10px]" : "text-[8px]"} font-mono px-1.5 py-0.5 rounded whitespace-nowrap`} style={{ backgroundColor: device.device_color + '20', color: device.device_color, border: `1px solid ${device.device_color}40` }}>{device.device_type}</span>
                    {isFullScreen && (
                      <ChevronDown className={`w-4 h-4 text-[#5C5A54] transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                    )}
                  </div>
                </div>

                {/* Compact info (sidebar mode) */}
                {!isFullScreen && (
                  <>
                    <div className="flex items-center gap-2 text-[9px] font-mono text-[#5C5A54]">
                      <span>Ports: {device.ports.slice(0, 8).join(', ')}{device.ports.length > 8 ? ` +${device.ports.length - 8}` : ''}</span>
                      {device.vulns.length > 0 && (
                        <div className="group relative flex items-center gap-1 cursor-help">
                          <span className="text-[#FF3D3D] flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5" /> {device.vulns.length} CVEs
                          </span>
                          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-50 p-2 bg-[#1A1A18] border border-[#FF3D3D50] rounded-md shadow-xl min-w-[140px] max-w-[220px] max-h-[150px] overflow-y-auto styled-scrollbar">
                            <div className="text-[8px] font-mono text-[#FF3D3D] mb-1 tracking-wider uppercase border-b border-[#FF3D3D30] pb-1">Identified Vulnerabilities</div>
                            <div className="flex flex-col gap-0.5">
                              {device.vulns.map((cve: string) => (
                                <a key={cve} href={`https://nvd.nist.gov/vuln/detail/${cve}`} target="_blank" rel="noreferrer" className="text-[9px] font-mono text-[#E8E6E0] hover:text-[#FF3D3D] transition-colors truncate">
                                  {cve}
                                </a>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {device.hostnames.length > 0 && <div className="text-[9px] font-mono text-[#8A8880] mt-0.5 truncate">{device.hostnames[0]}</div>}
                  </>
                )}

                {/* Full-Screen Expanded Detail */}
                {isFullScreen && isExpanded && (
                  <div className="border-t border-[#2A2A28]">
                    {/* Ports + Hostnames Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#2A2A28]">
                      <div className="bg-[#0D0D0C] p-4">
                        <div className="text-[10px] font-mono text-[#5C5A54] tracking-widest uppercase mb-2">Open Ports</div>
                        <div className="flex flex-wrap gap-1.5">
                          {device.ports.map((port: number) => (
                            <span key={port} className="px-2 py-1 bg-[#1A1A18] border border-[#2A2A28] rounded text-[11px] font-mono text-[var(--cyan-primary)]">{port}</span>
                          ))}
                        </div>
                      </div>
                      <div className="bg-[#0D0D0C] p-4">
                        <div className="text-[10px] font-mono text-[#5C5A54] tracking-widest uppercase mb-2">Hostnames</div>
                        {device.hostnames.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {device.hostnames.map((h: string) => (
                              <span key={h} className="text-[11px] font-mono text-[#E8E6E0]">{h}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-[#3A3A38]">No reverse DNS</span>
                        )}
                      </div>
                    </div>

                    {/* CVE Intelligence */}
                    {device.vulns.length > 0 && (
                      <div className="p-4 border-t border-[#2A2A28]">
                        <div className="text-[10px] font-mono text-[#5C5A54] tracking-widest uppercase mb-3">Vulnerabilities ({device.vulns.length})</div>
                        <div className="flex flex-col gap-2">
                          {device.vulns.map((cveId: string) => {
                            const info = cveCache[cveId];
                            const isLoading = !info || info.loading;
                            const severityColor = !info?.severity ? '#5C5A54'
                              : info.severity === 'CRITICAL' ? '#FF3D3D'
                              : info.severity === 'HIGH' ? '#FF6B00'
                              : info.severity === 'MEDIUM' ? '#FFD700'
                              : '#76FF03';
                            return (
                              <div key={cveId} className="bg-[#111] border border-[#2A2A28] rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[12px] font-mono font-bold text-[#E8E6E0]">{cveId}</span>
                                    {info?.cvss != null && (
                                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: severityColor + '15', color: severityColor, border: `1px solid ${severityColor}40` }}>CVSS {info.cvss}</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {info?.severity && (
                                      <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded" style={{ backgroundColor: severityColor + '15', color: severityColor, border: `1px solid ${severityColor}40` }}>{info.severity}</span>
                                    )}
                                    <a href={`https://nvd.nist.gov/vuln/detail/${cveId}`} target="_blank" rel="noreferrer" className="text-[#5C5A54] hover:text-[#E8E6E0] transition-colors">
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  </div>
                                </div>
                                {isLoading ? (
                                  <div className="flex items-center gap-2 py-1">
                                    <Loader2 className="w-3 h-3 animate-spin text-[#5C5A54]" />
                                    <span className="text-[10px] font-mono text-[#5C5A54]">Fetching vulnerability intelligence...</span>
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-[11px] font-mono text-[#8A8880] leading-relaxed">{info.description}</p>
                                    {info.cwe && <div className="text-[10px] font-mono text-[#5C5A54] mt-2">Weakness: {info.cwe}</div>}
                                    {info.affected && info.affected.length > 0 && (
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {info.affected.map((a: any, i: number) => (
                                          <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 bg-[#1A1A18] border border-[#2A2A28] rounded text-[#8A8880]">
                                            {a.vendor}/{a.product}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
            })}
          </div>
          <div className="px-3 py-2 border-t border-[#2A2A28]">
            <div className="text-[8px] font-mono text-[#5C5A54] tracking-wider">SWEPT {sweepResult.summary.total_hosts} HOSTS IN {(sweepResult.sweep_time_ms / 1000).toFixed(1)}s · ASN {sweepResult.center.asn}</div>
          </div>
        </div>
      )}

      {results && !(sweepResult && !loading) && (
        <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-primary)] rounded-lg p-3 max-h-[50vh] overflow-y-auto styled-scrollbar">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-mono tracking-widest" style={{ color: currentTab?.color }}>{currentTab?.label} RESULTS</span>
            <span className="text-[8px] font-mono text-[var(--text-muted)] flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{new Date().toLocaleTimeString()}</span>
          </div>
          {renderStructuredResults()}
        </div>
      )}

      {history.length > 0 && !results && (
        <div className="space-y-1">
          <span className="text-[9px] font-mono tracking-widest text-[var(--text-muted)]">RECENT SCANS</span>
          {history.slice(0, 5).map((h, i) => (
            <button key={i} onClick={() => { setActiveTab(h.tab); setQuery(h.query); }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-[var(--hover-accent)] transition-colors text-left">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono" style={{ color: TABS.find(t => t.id === h.tab)?.color }}>{TABS.find(t => t.id === h.tab)?.label}</span>
                <span className="text-[10px] font-mono text-[var(--text-secondary)]">{h.query}</span>
              </div>
              <span className="text-[8px] font-mono text-[var(--text-muted)]">{h.time}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (isMobile) return renderContent();

  if (isFullScreen) {
    const fullScreenNode = (
      <div className="fixed top-4 bottom-4 right-4 w-[40vw] min-w-[600px] max-w-[800px] z-[999] glass-panel bg-[#0a0a09]/95 backdrop-blur-2xl border border-[var(--cyan-primary)]/40 rounded-xl flex flex-col overflow-hidden shadow-2xl shadow-[var(--cyan-primary)]/20 transition-all duration-300">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-secondary)] bg-[#111]">
          <div className="flex items-center gap-3">
            <Radar className="w-5 h-5 text-[var(--cyan-primary)]" />
            <span className="hud-text text-[16px] text-[var(--text-primary)]">Organisation &amp; Asset Intelligence</span>
            <span className="gotham-tag gotham-tag--info" style={{ fontSize: '9px' }}>EXPANDED VIEW</span>
            <span className="gotham-tag gotham-tag--classified" style={{ fontSize: '8px' }}>{TABS.length} MODULES</span>
          </div>
          <button onClick={() => setIsFullScreen(false)} className="p-2 hover:bg-white/5 rounded transition-colors text-[var(--text-muted)] hover:text-white">
            <Minimize2 className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 styled-scrollbar">
          <div className="w-full full-screen-mode-content">
             {renderContent()}
          </div>
        </div>
      </div>
    );
    return typeof document !== 'undefined' ? createPortal(fullScreenNode, document.body) : fullScreenNode;
  }

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.6 }} className="glass-panel flex flex-col overflow-hidden pointer-events-auto shrink-0 h-[500px] max-h-[80vh] resize-y">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(0,0,0,0.3)] hover:bg-[var(--hover-accent)] transition-colors">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 flex-1">
          <Radar className="w-3.5 h-3.5 text-[var(--cyan-primary)]" />
          <span className="hud-text text-[12px] text-[var(--text-primary)]">Organisation &amp; Asset Intelligence</span>
          <span className="gotham-tag gotham-tag--info" style={{ fontSize: '7px', padding: '1px 5px' }}>INTEL TOOLS</span>
        </button>
        <div className="flex items-center gap-3">
          <button onClick={() => setIsFullScreen(true)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="Full Screen">
             <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--cyan-primary)] animate-kintel-pulse" />
          <button onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-y-auto px-3 py-3 flex-1 min-h-0 styled-scrollbar">
            {renderContent()}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const OsintPanel = memo(OsintPanelInner);
export default OsintPanel;
