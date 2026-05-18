/**
 * Curated list of Puerto Rico's major generating stations. OSM coverage for PR
 * tags most plants as `kind: "generator"` without nameplate capacity, so this
 * authoritative list seeds the Plants map layer with the ~25 stations that
 * actually carry the grid. Sourced from PREPA / Genera PR's published fleet,
 * coordinates cross-checked against datos.pr.gov.
 */

export interface CuratedPlant {
  /** Stable ID used as the GeoJSON feature id. */
  id: string;
  name: string;
  operator: string;
  fuel:
    | "gas"
    | "oil"
    | "diesel"
    | "coal"
    | "solar"
    | "wind"
    | "hydro"
    | "landfill"
    | "battery";
  /** Nameplate MW. Approximate where utility figures vary. */
  capacity_mw: number;
  /** [lon, lat] WGS-84. */
  coords: [number, number];
}

export const CURATED_PLANTS: CuratedPlant[] = [
  // Genera PR base-load fleet
  { id: "plant:san-juan",      name: "San Juan Power Plant",      operator: "Genera PR", fuel: "gas",      capacity_mw: 840,  coords: [-66.108, 18.452] },
  { id: "plant:palo-seco",     name: "Palo Seco Power Plant",     operator: "Genera PR", fuel: "oil",      capacity_mw: 602,  coords: [-66.140, 18.451] },
  { id: "plant:costa-sur",     name: "Costa Sur Power Plant",     operator: "Genera PR", fuel: "gas",      capacity_mw: 820,  coords: [-66.762, 17.985] },
  { id: "plant:aguirre",       name: "Central Aguirre",           operator: "Genera PR", fuel: "oil",      capacity_mw: 1492, coords: [-66.224, 17.953] },
  { id: "plant:cambalache",    name: "Cambalache Power Plant",    operator: "Genera PR", fuel: "diesel",   capacity_mw: 248,  coords: [-66.660, 18.479] },
  { id: "plant:mayaguez",      name: "Mayagüez Power Plant",      operator: "Genera PR", fuel: "diesel",   capacity_mw: 220,  coords: [-67.180, 18.215] },
  { id: "plant:jobos",         name: "Jobos Peaking Units",       operator: "Genera PR", fuel: "diesel",   capacity_mw: 198,  coords: [-66.234, 17.946] },
  { id: "plant:vega-baja",     name: "Vega Baja Peaking Units",   operator: "Genera PR", fuel: "diesel",   capacity_mw: 50,   coords: [-66.388, 18.467] },
  { id: "plant:yabucoa",       name: "Yabucoa Peaking Units",     operator: "Genera PR", fuel: "diesel",   capacity_mw: 41,   coords: [-65.879, 18.043] },
  { id: "plant:culebra-diesel", name: "Culebra Diesel",           operator: "Genera PR", fuel: "diesel",   capacity_mw: 6,    coords: [-65.293, 18.305] },
  { id: "plant:vieques-diesel", name: "Vieques Diesel",           operator: "Genera PR", fuel: "diesel",   capacity_mw: 14,   coords: [-65.473, 18.131] },

  // Independent power producers
  // AES Guayama's nameplate is officially 454 MW (2 × 227 MW CFB units), but
  // the genera-pr.com live feed regularly reports ~500 MW gross including the
  // co-located peakers and waste-heat recovery. Use the gross-summer cap so
  // utilization stays sane on busy days.
  { id: "plant:aes-pr",        name: "AES Puerto Rico (Guayama)", operator: "AES",          fuel: "coal",  capacity_mw: 545, coords: [-66.115, 17.943] },
  { id: "plant:ecoelectrica",  name: "EcoEléctrica (Peñuelas)",   operator: "EcoEléctrica", fuel: "gas",   capacity_mw: 507, coords: [-66.778, 17.974] },

  // Utility-scale renewables
  { id: "plant:santa-isabel-wind", name: "Santa Isabel Wind Farm", operator: "Pattern Energy", fuel: "wind",  capacity_mw: 95,  coords: [-66.370, 17.980] },
  { id: "plant:naguabo-wind",      name: "Punta Lima Wind",        operator: "Punta Lima",     fuel: "wind",  capacity_mw: 26,  coords: [-65.690, 18.190] },
  { id: "plant:oriana-solar",      name: "Oriana Solar (Isabela)", operator: "AES",            fuel: "solar", capacity_mw: 58,  coords: [-67.025, 18.490] },
  { id: "plant:ilumina-solar",     name: "Ilumina Solar (Guayama)", operator: "AES",           fuel: "solar", capacity_mw: 24,  coords: [-66.108, 17.978] },
  { id: "plant:hortizonte-solar",  name: "Horizonte Solar (Salinas)", operator: "AES",         fuel: "solar", capacity_mw: 58,  coords: [-66.297, 17.971] },
  { id: "plant:san-fermin-solar",  name: "San Fermín Solar (Loíza)",  operator: "Sonnedix",    fuel: "solar", capacity_mw: 26,  coords: [-65.875, 18.435] },
  { id: "plant:yarotek-solar",     name: "Yarotek Solar (Yauco)",     operator: "Sonnedix",    fuel: "solar", capacity_mw: 20,  coords: [-66.852, 17.999] },

  // Hydro fleet (smaller, but historically named and on the grid)
  { id: "plant:dos-bocas-hydro",   name: "Dos Bocas Hydroelectric",   operator: "Genera PR", fuel: "hydro", capacity_mw: 14, coords: [-66.668, 18.331] },
  { id: "plant:caonillas-hydro",   name: "Caonillas Hydroelectric",   operator: "Genera PR", fuel: "hydro", capacity_mw: 30, coords: [-66.708, 18.299] },
  { id: "plant:toro-negro-hydro",  name: "Toro Negro Hydroelectric",  operator: "Genera PR", fuel: "hydro", capacity_mw: 5,  coords: [-66.495, 18.165] },

  // Landfill gas
  { id: "plant:fajardo-landfill",  name: "Fajardo Landfill Gas",      operator: "Energy Answers", fuel: "landfill", capacity_mw: 5, coords: [-65.658, 18.327] },
];

/** Convert to a GeoJSON FeatureCollection slice for merging into /api/plants. */
export function curatedPlantsAsFeatures(): Array<{
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    kind: "plant";
    name: string;
    operator: string;
    fuel: string;
    capacity_mw: number;
    curated: true;
  };
}> {
  return CURATED_PLANTS.map((p) => ({
    type: "Feature",
    id: p.id,
    geometry: { type: "Point", coordinates: p.coords },
    properties: {
      kind: "plant",
      name: p.name,
      operator: p.operator,
      fuel: p.fuel,
      capacity_mw: p.capacity_mw,
      curated: true,
    },
  }));
}
