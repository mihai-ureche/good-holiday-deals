export const sourceCatalog = [
  { id: 'vola', name: 'Vola.ro', url: 'https://www.vola.ro/', mode: 'public-offers', detail: 'Public flight promotions. Dates and family fares need confirmation.' },
  { id: 'booking', name: 'Booking.com', url: 'https://www.booking.com/', mode: 'manual', detail: 'Live accommodation quotes need a supported provider integration.' },
  { id: 'travelminit', name: 'Travelminit.ro', url: 'https://travelminit.ro/', mode: 'public-offers', detail: 'Public stay promotions; advertised dates and occupancy may differ.' },
  { id: 'esky', name: 'eSky.ro', url: 'https://www.esky.ro/', mode: 'manual', detail: 'Automated search paths are excluded by the site’s crawling rules.' },
  { id: 'christiantour', name: 'ChristianTour.ro', url: 'https://christiantour.ro/', mode: 'public-offers', detail: 'Public holiday promotions. Exact travel dates and family total need confirmation.' },
  { id: 'directbooking', name: 'DirectBooking.ro', url: 'https://www.directbooking.ro/', mode: 'public-offers', detail: 'Public hotel starting prices; price basis and availability need confirmation.' },
  { id: 'amfostacolo', name: 'AmFostAcolo.ro', url: 'https://amfostacolo.ro/', mode: 'reviews', detail: 'Use for traveller reviews; not integrated as a live price source.' },
  { id: 'skyscanner', name: 'Skyscanner.ro', url: 'https://www.skyscanner.ro/', mode: 'manual', detail: 'Flight search results need a supported provider integration.' },
  { id: 'eximtur', name: 'Eximtur.ro', url: 'https://www.eximtur.ro/', mode: 'manual', detail: 'The inspected homepage did not expose usable live quotes.' },
  { id: 'paravion', name: 'Paravion.ro', url: 'https://www.paravion.ro/', mode: 'manual', detail: 'The inspected homepage redirected; a reliable quote integration is pending.' },
] as const;
