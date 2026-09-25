// Real photographs of Aktau from Wikimedia Commons, loaded from Wikimedia's
// thumbnail servers and credited in You → Data sources. CC BY-SA photos are
// used unmodified (cropped by CSS only).
export type Photo = { src: string; alt: string; author: string; license: string; page: string }

const T = 'https://thumb.wikimedia.org/wikipedia/commons/thumb'

export const PHOTOS = {
  shore: {
    src: `${T}/6/6a/Afternoon_Caspian_Seashore_in_Aktau_city.jpg/1280px-Afternoon_Caspian_Seashore_in_Aktau_city.jpg`,
    alt: 'Limestone shore of the Caspian Sea in Aktau in the afternoon', author: 'Rassim', license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Afternoon_Caspian_Seashore_in_Aktau_city.jpg',
  },
  sunset: {
    src: `${T}/0/02/Aktau_Sunset_over_the_Caspian_Sea.jpg/1280px-Aktau_Sunset_over_the_Caspian_Sea.jpg`,
    alt: 'Sunset over the Caspian Sea from Aktau', author: 'Rassim', license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Aktau_Sunset_over_the_Caspian_Sea.jpg',
  },
  lighthouse: {
    src: `${T}/0/04/Aktau-lighthouse.jpg/1280px-Aktau-lighthouse.jpg`,
    alt: 'The Aktau lighthouse on the roof of a residential block', author: 'Shalomanov', license: 'CC BY-SA 3.0',
    page: 'https://commons.wikimedia.org/wiki/File:Aktau-lighthouse.jpg',
  },
  promenade: {
    src: `${T}/f/f9/Pedestrian_walkway_along_the_Caspian_Sea_waterfront_promenade_in_Aktau%2C_Kazakhstan.jpg/1280px-Pedestrian_walkway_along_the_Caspian_Sea_waterfront_promenade_in_Aktau%2C_Kazakhstan.jpg`,
    alt: 'Walkway along the Caspian waterfront promenade in Aktau', author: 'IvarT', license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Pedestrian_walkway_along_the_Caspian_Sea_waterfront_promenade_in_Aktau,_Kazakhstan.jpg',
  },
  diving: {
    src: `${T}/5/51/Young_boys_diving_into_the_Caspian_Sea_from_the_rocky_shoreline_in_Aktau%2C_Kazakhstan.jpg/1280px-Young_boys_diving_into_the_Caspian_Sea_from_the_rocky_shoreline_in_Aktau%2C_Kazakhstan.jpg`,
    alt: 'Boys diving into the Caspian from the rocky shoreline in Aktau', author: 'IvarT', license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Young_boys_diving_into_the_Caspian_Sea_from_the_rocky_shoreline_in_Aktau,_Kazakhstan.jpg',
  },
  night: {
    src: `${T}/b/b8/Night_Ashore_in_Aktau.jpg/1280px-Night_Ashore_in_Aktau.jpg`,
    alt: 'The Aktau shore at night', author: 'Vita86', license: 'CC BY-SA 3.0',
    page: 'https://commons.wikimedia.org/wiki/File:Night_Ashore_in_Aktau.jpg',
  },
  yachts: {
    src: `${T}/f/f5/Yacht_club_in_Aktau.jpg/1280px-Yacht_club_in_Aktau.jpg`,
    alt: 'Yacht club in Aktau', author: 'Vita86', license: 'CC BY-SA 3.0',
    page: 'https://commons.wikimedia.org/wiki/File:Yacht_club_in_Aktau.jpg',
  },
  district: {
    src: `${T}/2/2e/%D0%90%D0%BA%D1%82%D0%B0%D1%83._%D0%BC%D0%BA%D1%80.32.jpg/960px-%D0%90%D0%BA%D1%82%D0%B0%D1%83._%D0%BC%D0%BA%D1%80.32.jpg`,
    alt: 'Residential blocks in the 32nd microdistrict of Aktau', author: 'Мағыпар', license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:%D0%90%D0%BA%D1%82%D0%B0%D1%83._%D0%BC%D0%BA%D1%80.32.jpg',
  },
} satisfies Record<string, Photo>

export const EVIDENCE_CREDITS: Photo[] = [
  { src: '', alt: 'Overflowing street bin (demo evidence)', author: 'unknown, public domain', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Overflowing_Hamburg_street_garbage_bin.jpg' },
  { src: '', alt: 'Waste container (demo evidence)', author: 'Nikolai Bulykin', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B,_%D0%BC%D1%83%D1%81%D0%BE%D1%80%D0%BD%D1%8B%D0%B9_%D0%B1%D0%B0%D0%BA_%D0%BD%D0%B0_%D0%BF%D0%BB%D0%BE%D1%89%D0%B0%D0%B4%D0%B8_%D0%90%D1%81%D1%82%D0%B0%D0%BD%D0%B0.jpg' },
  { src: '', alt: 'Street lamps by day (demo evidence)', author: 'Wee Hong', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Lamp_post_in_Pasir_Gudang.jpg' },
]

/** A stable photo for a news section when the story has no image. */
export function sectionPhoto(section: string): Photo {
  const by: Record<string, Photo> = { ecology: PHOTOS.shore, sport: PHOTOS.diving, culture: PHOTOS.night, ekonomika: PHOTOS.yachts, communal: PHOTOS.district, society: PHOTOS.promenade, vlast: PHOTOS.lighthouse }
  return by[section] ?? PHOTOS.sunset
}
