/**
 * The places the console imports by default.
 *
 * MAIN CITIES AND TOWNS ONLY, one entry each — no neighbourhoods. Each is
 * typed into Chowdeck's autocomplete exactly as a person would ("Lagos",
 * "Ogbomoso") and the place id it returns is what every search uses from then
 * on.
 *
 * Grouped by state, and ORDER IS MEANINGFUL: the first town in each state is
 * its main city (usually the capital, or the biggest place people order in).
 * The picker shows that one first and folds the rest behind "+N places", so
 * the order here is the order a cook sees.
 *
 * Wide on purpose. A town Chowdeck does not cover yet simply comes back with
 * no restaurants, which costs one cached "empty" answer; a town missing from
 * this list is somewhere a cook cannot even pick.
 */
export interface SeedPlace {
  /** What we type into their autocomplete. */
  query: string;
  /** The town itself — shown on the chip, and used for weather. */
  city: string;
  /** The group it is shown under. */
  state: string;
}

const state = (name: string, towns: readonly string[]): SeedPlace[] =>
  towns.map((town) => ({ query: town, city: town, state: name }));

export const DEFAULT_SEED_PLACES: readonly SeedPlace[] = [
  // ── South-west ─────────────────────────────────────────────────────────
  ...state('Lagos', ['Lagos', 'Ikeja', 'Ikorodu', 'Lekki', 'Epe', 'Badagry', 'Ajah', 'Ojo']),
  ...state('Oyo', ['Ibadan', 'Ogbomoso', 'Oyo', 'Iseyin', 'Saki', 'Igboho', 'Kishi', 'Eruwa', 'Igbo-Ora', 'Okeho']),
  ...state('Osun', ['Osogbo', 'Ile-Ife', 'Ilesa', 'Ede', 'Iwo', 'Ikirun', 'Ila-Orangun', 'Ikire', 'Ejigbo', 'Ipetumodu']),
  ...state('Ogun', ['Abeokuta', 'Ijebu-Ode', 'Sagamu', 'Ota', 'Ilaro', 'Ifo', 'Mowe', 'Ibafo', 'Ago-Iwoye', 'Ilishan-Remo']),
  ...state('Ondo', ['Akure', 'Ondo', 'Owo', 'Ikare', 'Okitipupa', 'Ore', 'Idanre']),
  ...state('Ekiti', ['Ado-Ekiti', 'Ikere-Ekiti', 'Ijero-Ekiti', 'Ise-Ekiti', 'Efon-Alaaye', 'Oye-Ekiti', 'Ikole-Ekiti']),

  // ── North-central ──────────────────────────────────────────────────────
  ...state('FCT', ['Abuja', 'Gwagwalada', 'Kubwa', 'Kuje', 'Bwari', 'Lugbe']),
  ...state('Kwara', ['Ilorin', 'Offa', 'Omu-Aran', 'Jebba', 'Lafiagi']),
  ...state('Kogi', ['Lokoja', 'Okene', 'Anyigba', 'Idah', 'Kabba']),
  ...state('Nasarawa', ['Lafia', 'Keffi', 'Karu', 'Akwanga', 'Nasarawa']),
  ...state('Niger', ['Minna', 'Suleja', 'Bida', 'Kontagora']),
  ...state('Plateau', ['Jos', 'Bukuru', 'Pankshin', 'Shendam']),
  ...state('Benue', ['Makurdi', 'Gboko', 'Otukpo', 'Katsina-Ala']),

  // ── South-south ────────────────────────────────────────────────────────
  ...state('Rivers', ['Port Harcourt', 'Obio-Akpor', 'Bonny', 'Omoku', 'Eleme']),
  ...state('Delta', ['Asaba', 'Warri', 'Effurun', 'Sapele', 'Ughelli', 'Agbor', 'Abraka', 'Oleh']),
  ...state('Edo', ['Benin City', 'Auchi', 'Ekpoma', 'Uromi', 'Igarra']),
  ...state('Bayelsa', ['Yenagoa', 'Amassoma', 'Brass']),
  ...state('Akwa Ibom', ['Uyo', 'Eket', 'Ikot Ekpene', 'Oron', 'Abak']),
  ...state('Cross River', ['Calabar', 'Ikom', 'Ogoja', 'Ugep']),

  // ── South-east ─────────────────────────────────────────────────────────
  ...state('Anambra', ['Awka', 'Onitsha', 'Nnewi', 'Ekwulobia', 'Ihiala', 'Otuocha']),
  ...state('Enugu', ['Enugu', 'Nsukka', 'Agbani', 'Oji River', 'Awgu']),
  ...state('Imo', ['Owerri', 'Orlu', 'Okigwe', 'Mbaise']),
  ...state('Abia', ['Umuahia', 'Aba', 'Ohafia', 'Arochukwu']),
  ...state('Ebonyi', ['Abakaliki', 'Afikpo', 'Onueke']),

  // ── North-west ─────────────────────────────────────────────────────────
  ...state('Kano', ['Kano', 'Wudil', 'Bichi', 'Rano']),
  ...state('Kaduna', ['Kaduna', 'Zaria', 'Kafanchan', 'Saminaka']),
  ...state('Katsina', ['Katsina', 'Funtua', 'Daura', 'Malumfashi']),
  ...state('Sokoto', ['Sokoto', 'Tambuwal']),
  ...state('Kebbi', ['Birnin Kebbi', 'Argungu', 'Yauri']),
  ...state('Zamfara', ['Gusau', 'Kaura Namoda']),
  ...state('Jigawa', ['Dutse', 'Hadejia', 'Kazaure']),

  // ── North-east ─────────────────────────────────────────────────────────
  ...state('Bauchi', ['Bauchi', 'Azare', 'Misau']),
  ...state('Gombe', ['Gombe', 'Kumo', 'Billiri']),
  ...state('Adamawa', ['Yola', 'Jimeta', 'Mubi', 'Numan']),
  ...state('Taraba', ['Jalingo', 'Wukari', 'Takum']),
  ...state('Borno', ['Maiduguri', 'Biu']),
  ...state('Yobe', ['Damaturu', 'Potiskum', 'Gashua']),
];
