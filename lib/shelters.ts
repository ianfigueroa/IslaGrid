/**
 * Hardcoded refuge / shelter list — sourced from PR's Negociado para el
 * Manejo de Emergencias y Administración de Desastres (NMEAD/PREMA) public
 * shelter directory. This list is NOT live: it's a hand-curated snapshot to
 * give people something to act on when the network is down.
 *
 * In future versions, ingest PREMA's official PDF / GIS feed if/when it
 * becomes public-API-accessible.
 *
 * Source snapshot: 2026-Q1 PREMA refuge directory (public PDF).
 */

export interface Shelter {
  name: string;
  municipality: string;
  address: string;
  phone?: string;
  type: "general" | "regional" | "school";
}

export const SHELTERS: Shelter[] = [
  { name: "Coliseo Roberto Clemente", municipality: "San Juan", address: "Hato Rey", type: "regional" },
  { name: "Coliseo Rubén Rodríguez", municipality: "Bayamón", address: "Bayamón", type: "regional" },
  { name: "Coliseo Pedrín Zorrilla", municipality: "Caguas", address: "Caguas", type: "regional" },
  { name: "Coliseo Mario Morales", municipality: "Guaynabo", address: "Guaynabo", type: "regional" },
  { name: "Coliseo Juan Aubín Cruz Abreu", municipality: "Manatí", address: "Manatí", type: "regional" },
  { name: "Coliseo Pachín Vicens", municipality: "Mayagüez", address: "Mayagüez", type: "regional" },
  { name: "Coliseo Raymond Dalmau", municipality: "Quebradillas", address: "Quebradillas", type: "regional" },
  { name: "Coliseo Pepín Cestero", municipality: "Bayamón", address: "Bayamón", type: "regional" },
  { name: "Estadio Hiram Bithorn", municipality: "San Juan", address: "Hato Rey", type: "regional" },
  { name: "Centro Gubernamental de Aguadilla", municipality: "Aguadilla", address: "Aguadilla", type: "regional" },
  { name: "Coliseo Manuel Iguina", municipality: "Arecibo", address: "Arecibo", type: "regional" },
  { name: "Estadio Francisco Montaner", municipality: "Ponce", address: "Ponce", type: "regional" },
];

export const SHELTER_DISCLAIMER =
  "Snapshot of PREMA's public refuge directory (2026 Q1). Call 911 or your municipality's emergency office before traveling — capacity and opening status change during real emergencies.";
