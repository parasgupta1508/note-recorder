Instrument sample banks used by the app (Hear scale / Hear piece / Listen, and the speaker test). Every recording is CC0 1.0 (public domain dedication).

violin/   VSCO 2 Community Edition, "Solo Violin, Arco Vib" (Versilian Studios, Sam Gossner)        https://github.com/sgossner/VSCO-2-CE
guitar/   FreePats "Spanish Classical Guitar" (Roberto Garcia)                                       https://freepats.zenvoid.org/Guitar/acoustic-guitar.html
ukulele/  FreePats "Ukulele"                                                                         https://freepats.zenvoid.org/GuitarFamily/ukulele.html
piano/    FreePats "Upright Piano KW" (small), a Kawai upright piano                                 https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html

Each folder has index.json: for every recording its key (midi), its layer (violin: f loud, p soft), the tuning offset in cents measured with the app's own pitch detector, its level and,
for the violin, the vibrato the player really made. The MP3s are the originals cut short, made mono 44.1 kHz, with a faded tail.
Rebuild with: node tools/samples/build.js <folder with the downloaded originals>   (see the header of tools/samples/build.js)
