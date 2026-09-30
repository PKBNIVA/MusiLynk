# Image credits

Photographs under `public/img/` are editorial images for public pages (landing, join, hire and rates pages, pricing, about, guide). Each is a Wikimedia Commons file used under the licence shown; the same list is rendered at `/credits` from `src/app/pages/public/imageCredits.ts`. A test fails if a file, this table and that list drift apart.

Rules: CC0, public domain and CC BY first; CC BY-SA only where no other candidate existed for the subject (Carnatic vocal). Photographs are never attached to a person's profile: a real face on another person's profile would be a lie. Generated artwork (`CoverArt`, `ArtAvatar`) is not a photograph and is not listed. Each photo exists at 800 and 1600 pixels wide as `<file>-800.webp` and `<file>-1600.webp`.

Two of the photos (tabla, saxophone) carry a Commons "personality rights" note: they show identifiable people, so use them only as editorial images with the caption context, never to imply endorsement.

| File | Subject | Title | Author | Licence | Source |
|---|---|---|---|---|---|
| `carnatic-vocalist` | Carnatic vocal | Sk Mahathi, during a Carnatic Music concert at Kakkengad, Kannur (183).jpg | Vinayaraj | CC BY-SA 4.0 | <https://commons.wikimedia.org/wiki/File:Sk_Mahathi,_during_a_Carnatic_Music_concert_at_Kakkengad,_Kannur_(183).jpg> |
| `dj-goa` | DJ | Vagator, Goa, India, DJ playing music on turntable.jpg | Vyacheslav Argenberg | CC BY 4.0 | <https://commons.wikimedia.org/wiki/File:Vagator,_Goa,_India,_DJ_playing_music_on_turntable.jpg> |
| `drum-kit` | Drum kit | Pats drums (2941761250).jpg | Kuba Bożanowski | CC BY 2.0 | <https://commons.wikimedia.org/wiki/File:Pats_drums_(2941761250).jpg> |
| `festival-goa` | Festival stage | Sunburn Festival, Goa, Back Stage.jpg | Vyacheslav Argenberg | CC BY 4.0 | <https://commons.wikimedia.org/wiki/File:Sunburn_Festival,_Goa,_Back_Stage.jpg> |
| `guitarist-stage` | Guitar | Moms Day lead guitarist live in concert.jpg | Erik Albers | CC0 | <https://commons.wikimedia.org/wiki/File:Moms_Day_lead_guitarist_live_in_concert.jpg> |
| `hindustani-vocalist` | Hindustani vocal | Vikas Kashalkar in COncert.JPG | Gaikiakash | CC0 | <https://commons.wikimedia.org/wiki/File:Vikas_Kashalkar_in_COncert.JPG> |
| `keyboard-player` | Keyboard | Keyboard player in Iran - Iranian musicians - Persian music band, depressed rock 02.jpg | Mostafameraji | CC0 | <https://commons.wikimedia.org/wiki/File:Keyboard_player_in_Iran_-_Iranian_musicians_-_Persian_music_band,_depressed_rock_02.jpg> |
| `qawwali-ensemble` | Qawwali | FFA long shot color.jpg | Fannafiallah | Public domain | <https://commons.wikimedia.org/wiki/File:FFA_long_shot_color.jpg> |
| `recording-studio` | Recording console | Recording studio console for DAW work (2016-03-23 15.01.29 by DayronV @pixabay 1290087).jpg | Dayron Villaverde | CC0 | <https://commons.wikimedia.org/wiki/File:Recording_studio_console_for_DAW_work_(2016-03-23_15.01.29_by_DayronV_@pixabay_1290087).jpg> |
| `rehearsal-room` | Rehearsal room | A depressive rock band in Iran- Music rehearsal space- Canon Photography-Mortaz band- Photographer mostafa meraji 06.jpg | Mostafameraji | CC BY 4.0 | <https://commons.wikimedia.org/wiki/File:A_depressive_rock_band_in_Iran-_Music_rehearsal_space-_Canon_Photography-Mortaz_band-_Photographer_mostafa_meraji_06.jpg> |
| `santoor-fusion` | Santoor and tabla | Nishagandhi 2014 (12088804024).jpg | Thejas Panarkandy | CC BY 2.0 | <https://commons.wikimedia.org/wiki/File:Nishagandhi_2014_(12088804024).jpg> |
| `sarod-mumbai` | Sarod | Sarod concert (4392998237).jpg | Scott McLeod | CC BY 2.0 | <https://commons.wikimedia.org/wiki/File:Sarod_concert_(4392998237).jpg> |
| `saxophonist` | Saxophone | Jazz saxophonist Richard Howell, 2015.jpg | usbotschaftberlin | Public domain | <https://commons.wikimedia.org/wiki/File:Jazz_saxophonist_Richard_Howell,_2015.jpg> |
| `shehnai-wedding` | Shehnai, tabla and harmonium | Musician play Sambal, Shehnai, and harmonium at an Indian event (2022).jpg | Kiran891 | Public domain | <https://commons.wikimedia.org/wiki/File:Musician_play_Sambal,_Shehnai,_and_harmonium_at_an_Indian_event_(2022).jpg> |
| `sitar-trio` | Sitar | Raga du soir au Collège des Bernardins (4730079050).jpg | dalbera | CC BY 2.0 | <https://commons.wikimedia.org/wiki/File:Raga_du_soir_au_Coll%C3%A8ge_des_Bernardins_(4730079050).jpg> |
| `sound-desk` | Live sound desk | Monitor Mixing Setup.jpg | Sonicvibesolutions | CC BY 4.0 | <https://commons.wikimedia.org/wiki/File:Monitor_Mixing_Setup.jpg> |
| `tabla-kolkata` | Tabla | Subhadrakalyan Rana Rehearsing Tabla with Sudhir Ghorai - Kolkata 2016-03-29 3183.JPG | Biswarup Ganguly | CC BY 3.0 | <https://commons.wikimedia.org/wiki/File:Subhadrakalyan_Rana_Rehearsing_Tabla_with_Sudhir_Ghorai_-_Kolkata_2016-03-29_3183.JPG> |

To add a photo: find it on Commons (User-Agent `VerseMarketplace/1.0 (+https://verse-music-platform.vercel.app)`, one request per second), check `LicenseShortName` in `extmetadata`, convert to WebP at 1600 and 800 wide (`npx --yes sharp-cli`, 1600 variant at most 160 KB), add the row here and in `imageCredits.ts`. The whole set stays under 4 MB.
