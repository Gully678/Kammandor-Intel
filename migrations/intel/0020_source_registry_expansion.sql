-- KINTEL intel_0020 — Source registry expansion (Shadowbroker breadth, governed)
--
-- Registers the Shadowbroker source matrix (INVENTORY §2) into the governed
-- source catalogue. ADDITIVE + IDEMPOTENT: `on conflict (key) do nothing` — the
-- existing 10 rows are never mutated. governed-vs-map-visual is encoded by
-- render_mode ('enrichment'/'panel' = governed ontology inputs; 'map-layer' =
-- labelled ephemeral live telemetry, never asserted as governed truth).
--
-- Licences recorded verbatim (public-open = US-federal PD / CC0;
-- public-attribution = CC-BY/ODbL/CC-BY-SA; licensed = commercial/key-gated;
-- proprietary = restricted redistribution). Repo owner controls source code;
-- DATA licences below are third-party and MUST be honoured (attribution /
-- non-commercial nuances flagged in licence_terms).
--
-- Governance unchanged: connectors write ONLY intel.proposed_edit; the approve
-- RPC remains the sole ontology writer; RLS on intel.sources unchanged.

insert into intel.sources
  (key, label, category, tier, auth, render_mode, enabled_by_default, licence_class, licence_terms, licence_url) values
-- Sanctions / entity (GOVERNED)
  ('ofac-sdn','OFAC SDN (US Treasury)','sanctions','free','none','enrichment',true,'public-open','US Treasury OFAC Specially Designated Nationals & Blocked Persons list — US Government work, public domain (17 U.S.C. 105).','https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists'),
  ('wikidata','Wikidata Entities','entity','free','none','enrichment',true,'public-open','CC0 1.0 Universal (public domain dedication).','https://www.wikidata.org/wiki/Wikidata:Licensing'),
  ('wikipedia','Wikipedia Summaries','entity','free','none','enrichment',false,'public-attribution','CC BY-SA 4.0 — attribution + share-alike.','https://en.wikipedia.org/wiki/Wikipedia:Copyrights'),
-- Financial (Finnhub licensed -> founder-gated OFF)
  ('finnhub','Finnhub Market Signals','financial','byok','tenant-key','panel',false,'licensed','Commercial API (congress/insider/dark-pool/flow). Redistribution restricted; founder-gated pending costed proposal.','https://finnhub.io/terms-of-service'),
  ('polymarket','Polymarket Prediction Markets','financial','free','none','panel',false,'public-attribution','Polymarket public API terms (attribution).','https://polymarket.com'),
  ('kalshi','Kalshi Event Markets','financial','free','none','panel',false,'public-attribution','Kalshi public API terms (attribution).','https://kalshi.com'),
-- Aircraft (VISUAL)
  ('adsb-lol','ADS-B (adsb.lol)','aircraft','free','none','map-layer',true,'public-attribution','ODbL — attribution "adsb.lol (ODbL)" required on derivative displays.','https://opendatacommons.org/licenses/odbl/'),
  ('airplanes-live','ADS-B (airplanes.live)','aircraft','free','none','map-layer',false,'public-attribution','airplanes.live community terms — attribution required.','https://airplanes.live'),
  ('adsb-fi','ADS-B (adsb.fi)','aircraft','free','none','map-layer',false,'public-attribution','adsb.fi open data terms — attribution required.','https://adsb.fi'),
  ('opensky','OpenSky Network','aircraft','byok','tenant-key','map-layer',false,'licensed','OpenSky terms — non-commercial by default; commercial use requires agreement. OAuth key required.','https://opensky-network.org/about/terms-of-use'),
  ('ourairports','OurAirports Reference','aircraft','free','none','enrichment',false,'public-open','OurAirports — dedicated to the public domain.','https://ourairports.com/data/'),
  ('airframes','Airframes.io ACARS/VDL','aircraft','byok','tenant-key','enrichment',false,'licensed','Airframes.io API — operator key + terms.','https://app.airframes.io'),
-- Maritime (VISUAL)
  ('aisstream','AISStream Live AIS','maritime','byok','tenant-key','map-layer',false,'licensed','aisstream.io terms — operator key required.','https://aisstream.io'),
  ('aishub','AISHub AIS','maritime','byok','tenant-key','map-layer',false,'licensed','AISHub data-sharing terms — contributing member key required.','https://www.aishub.net'),
  ('gfw','Global Fishing Watch','maritime','byok','tenant-key','map-layer',false,'public-attribution','GFW — CC BY-NC 4.0 (non-commercial); commercial use needs verification. API token required.','https://globalfishingwatch.org/our-apis/'),
  ('usni-fleet','USNI Fleet Tracker','maritime','free','none','map-layer',false,'public-attribution','USNI News weekly fleet tracker — attribution; low-precision.','https://news.usni.org'),
-- Satellite / SAR (VISUAL)
  ('celestrak','CelesTrak TLE','satellite','free','none','map-layer',false,'public-open','CelesTrak fair-use terms (orbital elements).','https://celestrak.org'),
  ('satnogs','SatNOGS Ground Stations','satellite','free','none','map-layer',false,'public-attribution','SatNOGS / Libre Space Foundation — CC BY-SA.','https://satnogs.org'),
  ('planetary-computer','MS Planetary Computer (Sentinel-2)','satellite','free','none','map-layer',false,'public-attribution','Microsoft Planetary Computer — data under source licences (Copernicus/ESA).','https://planetarycomputer.microsoft.com'),
  ('copernicus-sentinel','Copernicus Sentinel Hub','satellite','byok','tenant-key','map-layer',false,'licensed','Copernicus data full-free-open; Sentinel Hub API OAuth key required.','https://dataspace.copernicus.eu'),
-- Environmental (VISUAL, mostly US-federal PD)
  ('usgs-earthquakes','USGS Earthquakes','environmental','free','none','map-layer',true,'public-open','US Geological Survey — US Government public domain.','https://earthquake.usgs.gov'),
  ('nasa-firms','NASA FIRMS Fire/Thermal','environmental','byok','tenant-key','map-layer',false,'public-open','NASA data public domain; FIRMS MAP_KEY required for API.','https://firms.modaps.eosdis.nasa.gov'),
  ('noaa-swpc','NOAA Space Weather','environmental','free','none','map-layer',false,'public-open','NOAA SWPC — US Government public domain.','https://www.swpc.noaa.gov'),
  ('noaa-nws','NOAA Weather Alerts','environmental','free','none','map-layer',false,'public-open','NOAA NWS api.weather.gov — US Government public domain.','https://www.weather.gov/documentation/services-web-api'),
  ('openaq','OpenAQ Air Quality','environmental','byok','tenant-key','map-layer',false,'public-attribution','OpenAQ — CC BY 4.0; API key required.','https://openaq.org'),
  ('gvp-volcanoes','Smithsonian GVP Volcanoes','environmental','free','none','map-layer',false,'public-attribution','Smithsonian Global Volcanism Program — attribution.','https://volcano.si.edu'),
-- Conflict / geopolitics (VISUAL)
  ('deepstate','DeepState Ukraine Frontline','conflict','free','none','map-layer',false,'public-attribution','DeepStateMap — attribution (GeoJSON mirror).','https://deepstatemap.live'),
  ('liveuamap','LiveUAMap Events','conflict','byok','tenant-key','map-layer',false,'proprietary','LiveUAMap — redistribution restricted; opt-in only.','https://liveuamap.com'),
  ('ukraine-alerts','Ukraine Air-Raid Alerts','conflict','byok','tenant-key','map-layer',false,'licensed','alerts.in.ua — API token + terms.','https://alerts.in.ua'),
  ('telegram-osint','Telegram OSINT Channels','conflict','free','none','map-layer',false,'proprietary','Public channel content — per-channel rights; opt-in; geoparsed.','https://telegram.org'),
-- Cyber (mixed)
  ('cisa-kev','CISA Known Exploited Vulns','cyber','free','none','panel',false,'public-open','CISA KEV — US Government public domain.','https://www.cisa.gov/known-exploited-vulnerabilities-catalog'),
  ('urlhaus','abuse.ch URLhaus C2','cyber','free','none','map-layer',false,'public-attribution','abuse.ch URLhaus — attribution; commercial nuance to verify.','https://urlhaus.abuse.ch'),
  ('shodan','Shodan','cyber','byok','tenant-key','panel',false,'licensed','Shodan — API key + commercial terms.','https://www.shodan.io'),
  ('ioda','IODA Internet Outages','cyber','free','none','map-layer',false,'public-attribution','Georgia Tech IODA — attribution.','https://ioda.inetintel.cc.gatech.edu'),
-- Infrastructure (VISUAL)
  ('wri-powerplants','WRI Global Power Plants','infrastructure','free','none','map-layer',false,'public-attribution','WRI Global Power Plant DB — CC BY 4.0.','https://datasets.wri.org/dataset/globalpowerplantdatabase'),
  ('cctv','Public CCTV / DOT Cameras','infrastructure','free','none','map-layer',true,'public-open','US DOT 511 / TravelIQ public traffic-camera catalogs (HLS).','https://ops.fhwa.dot.gov'),
  ('ripe-atlas','RIPE Atlas Measurements','infrastructure','free','none','map-layer',false,'public-attribution','RIPE NCC — attribution.','https://atlas.ripe.net'),
  ('trains','Rail Positions (Digitraffic/Amtraker)','infrastructure','free','none','map-layer',false,'public-open','Fintraffic Digitraffic (CC BY 4.0) / Amtraker public API.','https://www.digitraffic.fi'),
-- Geo / basemap (enrichment/visual)
  ('nominatim','Nominatim Geocoding (OSM)','geo','free','none','enrichment',false,'public-attribution','ODbL — "© OpenStreetMap contributors" attribution required.','https://operations.osmfoundation.org/policies/nominatim/'),
  ('photon','Photon Geocoding (Komoot)','geo','free','none','enrichment',false,'public-attribution','ODbL (OpenStreetMap-derived).','https://photon.komoot.io'),
  ('mapbox','Mapbox Tiles/Geocoding','geo','byok','tenant-key','map-layer',false,'licensed','Mapbox commercial terms; access token required.','https://www.mapbox.com/legal/tos')
on conflict (key) do nothing;
