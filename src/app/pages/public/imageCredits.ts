/**
 * Credits for every photograph in public/img. One entry per `<file>-800.webp` / `<file>-1600.webp`
 * pair; docs/IMAGE_CREDITS.md lists the same rows and a test keeps the two, and the files, in step.
 * Photos are editorial only: never attach one to a person's profile.
 */
export type ImageCredit = {
  /** Base name under /img, without size or extension: `/img/${file}-1600.webp`. */
  file: string;
  subject: string;
  alt: string;
  /** Commons file title (without the `File:` prefix). */
  title: string;
  author: string;
  licence: string;
  licenceUrl: string;
  sourceUrl: string;
  /** Intrinsic size of the 1600 variant. */
  width: number;
  height: number;
  place?: string;
};

export const IMAGE_CREDITS: readonly ImageCredit[] = [
  {
    file: 'carnatic-vocalist',
    subject: 'Carnatic vocal',
    alt: 'A Carnatic vocalist in a yellow saree singing into a microphone',
    place: 'Kannur, India',
    title: 'Sk Mahathi, during a Carnatic Music concert at Kakkengad, Kannur (183).jpg',
    author: 'Vinayaraj',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Sk_Mahathi,_during_a_Carnatic_Music_concert_at_Kakkengad,_Kannur_(183).jpg',
    width: 1600,
    height: 1067,
  },
  {
    file: 'dj-goa',
    subject: 'DJ',
    alt: "A DJ's hands on a turntable and mixer",
    place: 'Vagator, Goa, India',
    title: 'Vagator, Goa, India, DJ playing music on turntable.jpg',
    author: 'Vyacheslav Argenberg',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Vagator,_Goa,_India,_DJ_playing_music_on_turntable.jpg',
    width: 1600,
    height: 1067,
  },
  {
    file: 'drum-kit',
    subject: 'Drum kit',
    alt: 'A drum kit and microphones set up on a stage',
    title: 'Pats drums (2941761250).jpg',
    author: 'Kuba Bożanowski',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Pats_drums_(2941761250).jpg',
    width: 1600,
    height: 1063,
  },
  {
    file: 'festival-goa',
    subject: 'Festival stage',
    alt: 'Silhouettes of a crowd under coloured canopies at sunset at a festival',
    place: 'Goa, India',
    title: 'Sunburn Festival, Goa, Back Stage.jpg',
    author: 'Vyacheslav Argenberg',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sunburn_Festival,_Goa,_Back_Stage.jpg',
    width: 1600,
    height: 1067,
  },
  {
    file: 'guitarist-stage',
    subject: 'Guitar',
    alt: 'A lead guitarist mid-riff on stage, in black and white',
    title: 'Moms Day lead guitarist live in concert.jpg',
    author: 'Erik Albers',
    licence: 'CC0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Moms_Day_lead_guitarist_live_in_concert.jpg',
    width: 1600,
    height: 1067,
  },
  {
    file: 'hindustani-vocalist',
    subject: 'Hindustani vocal',
    alt: 'A Hindustani vocalist beside a tanpura, mid-phrase',
    title: 'Vikas Kashalkar in COncert.JPG',
    author: 'Gaikiakash',
    licence: 'CC0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Vikas_Kashalkar_in_COncert.JPG',
    width: 1600,
    height: 1064,
  },
  {
    file: 'keyboard-player',
    subject: 'Keyboard',
    alt: 'A keyboard player at a stage piano with congas behind him',
    place: 'Iran',
    title: 'Keyboard player in Iran - Iranian musicians - Persian music band, depressed rock 02.jpg',
    author: 'Mostafameraji',
    licence: 'CC0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Keyboard_player_in_Iran_-_Iranian_musicians_-_Persian_music_band,_depressed_rock_02.jpg',
    width: 1600,
    height: 1067,
  },
  {
    file: 'qawwali-ensemble',
    subject: 'Qawwali',
    alt: 'A qawwali ensemble seated with harmoniums and tabla in front of a banner',
    title: 'FFA long shot color.jpg',
    author: 'Fannafiallah',
    licence: 'Public domain',
    licenceUrl: '',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:FFA_long_shot_color.jpg',
    width: 1600,
    height: 1029,
  },
  {
    file: 'recording-studio',
    subject: 'Recording console',
    alt: 'A recording studio with a mixing console between two pairs of monitors',
    title: 'Recording studio console for DAW work (2016-03-23 15.01.29 by DayronV @pixabay 1290087).jpg',
    author: 'Dayron Villaverde',
    licence: 'CC0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Recording_studio_console_for_DAW_work_(2016-03-23_15.01.29_by_DayronV_@pixabay_1290087).jpg',
    width: 1600,
    height: 968,
  },
  {
    file: 'rehearsal-room',
    subject: 'Rehearsal room',
    alt: 'A guitarist rehearsing in a studio with a drum kit behind',
    place: 'Iran',
    title:
      'A depressive rock band in Iran- Music rehearsal space- Canon Photography-Mortaz band- Photographer mostafa meraji 06.jpg',
    author: 'Mostafameraji',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:A_depressive_rock_band_in_Iran-_Music_rehearsal_space-_Canon_Photography-Mortaz_band-_Photographer_mostafa_meraji_06.jpg',
    width: 1600,
    height: 1067,
  },
  {
    file: 'santoor-fusion',
    subject: 'Santoor and tabla',
    alt: 'A santoor player, a tabla player and a keyboardist on a lit festival stage',
    title: 'Nishagandhi 2014 (12088804024).jpg',
    author: 'Thejas Panarkandy',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Nishagandhi_2014_(12088804024).jpg',
    width: 1600,
    height: 1063,
  },
  {
    file: 'sarod-mumbai',
    subject: 'Sarod',
    alt: 'Two sarod players and a tabla player performing on a garlanded stage',
    place: 'Mumbai, India',
    title: 'Sarod concert (4392998237).jpg',
    author: 'Scott McLeod',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sarod_concert_(4392998237).jpg',
    width: 1600,
    height: 1200,
  },
  {
    file: 'saxophonist',
    subject: 'Saxophone',
    alt: 'A jazz saxophonist playing tenor saxophone in a hall',
    title: 'Jazz saxophonist Richard Howell, 2015.jpg',
    author: 'usbotschaftberlin',
    licence: 'Public domain',
    licenceUrl: '',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Jazz_saxophonist_Richard_Howell,_2015.jpg',
    width: 1600,
    height: 1067,
  },
  {
    file: 'shehnai-wedding',
    subject: 'Shehnai, tabla and harmonium',
    alt: 'Three musicians seated on a rug playing tabla, shehnai and harmonium at an event',
    title: 'Musician play Sambal, Shehnai, and harmonium at an Indian event (2022).jpg',
    author: 'Kiran891',
    licence: 'Public domain',
    licenceUrl: '',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Musician_play_Sambal,_Shehnai,_and_harmonium_at_an_Indian_event_(2022).jpg',
    width: 1600,
    height: 1067,
  },
  {
    file: 'sitar-trio',
    subject: 'Sitar',
    alt: 'A sitar player and a tabla player on stage in front of a rose window',
    place: 'Paris, France',
    title: 'Raga du soir au Collège des Bernardins (4730079050).jpg',
    author: 'dalbera',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Raga_du_soir_au_Coll%C3%A8ge_des_Bernardins_(4730079050).jpg',
    width: 1600,
    height: 1200,
  },
  {
    file: 'sound-desk',
    subject: 'Live sound desk',
    alt: 'A digital live-sound mixing desk and racks in a dark hall',
    title: 'Monitor Mixing Setup.jpg',
    author: 'Sonicvibesolutions',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Monitor_Mixing_Setup.jpg',
    width: 1600,
    height: 1200,
  },
  {
    file: 'tabla-kolkata',
    subject: 'Tabla',
    alt: 'Two tabla players seated on a white sheet, rehearsing with microphones set up around the drums',
    place: 'Kolkata, India',
    title: 'Subhadrakalyan Rana Rehearsing Tabla with Sudhir Ghorai - Kolkata 2016-03-29 3183.JPG',
    author: 'Biswarup Ganguly',
    licence: 'CC BY 3.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Subhadrakalyan_Rana_Rehearsing_Tabla_with_Sudhir_Ghorai_-_Kolkata_2016-03-29_3183.JPG',
    width: 1600,
    height: 1063,
  },
];

/** `“Title” by Author, licence (place)`, as printed on the credits page. */
export function creditLine(credit: ImageCredit) {
  const where = credit.place ? `, ${credit.place}` : '';
  return `“${credit.title.replace(/\.(jpe?g|png)$/i, '')}” by ${credit.author}, ${credit.licence}${where}`;
}
