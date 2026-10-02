# MusiLynk Music Role Taxonomy

The runtime taxonomy lives in `CatalogController::ROLE_CATEGORIES`
(`backend/app/controllers/catalog_controller.rb`) and is served by `GET /api/taxonomy`
together with instruments, act types, event types, engagement types, opportunity kinds,
function areas, workplaces and currencies.

It covers ten role families:
1. `performance`: vocal and performing roles.
2. `strings`: string instruments.
3. `keys_winds`: keys, winds and brass.
4. `rhythm`: drums and percussion, including Indian percussion.
5. `writing`: composition, songwriting, arranging and production.
6. `studio`: studio and audio engineering.
7. `live`: live sound, stage, touring, lighting/video and technical operations.
8. `business`: management, booking, A&R, label, rights and marketing roles.
9. `education_wellness`: teaching, coaching and music therapy.
10. `media`: journalism, photography, video and content.

Search expands common layperson terms ("sound guy", "keys player", "roadie") through
`SearchController::SYNONYM_GROUPS`.

Future work: replace display strings with canonical role IDs, synonyms, parent/child
categories and proficiency metadata so search does not fragment on spelling variants.
