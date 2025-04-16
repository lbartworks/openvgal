https://github.com/lbartworks/openvgal/assets/121262093/517b6b67-7a87-4f2c-8166-b5c9314ff9e9


# OpenVgal v2


 (Open source Virtual Gallery)
Virtual 3D gallery for art showcase. Based on Babylon.js



-----------------------------------------

Version 2 brings some significant improvements:
- Making it easier for anyone to test it in their own computer. I have packed all into a single executable.
- An installation video is available.
- Improvements in lights and galleries

OpenVgal started in June 2022 as a personal project to provide myself, or anyone, a way to build an interactive 3D virtual gallery programmatically. What this means is that you do not need to design the hall or halls of the galleries, or deal with the 3D work, or the browser code to move around it. You just need organize your collections in folders and run some code provided here.  I was inspired by what Oncyber was creating but they had not open sourced the project. 

A demonstration of the gallery can be seen here:
[https://nostromophoto.com/virtual/virtual.html](https://nostromophoto.com/virtual/virtual.html)

Although in v1.4 the effort/skills had dropped significantly from v0.1 it was by no means a one-click process, heavily restricting the scope of artists who are less savvy. V2 is delivered in two different ways:

* An executable installer (available in Windows, Macos and Linux)

* Download the source code and run it with your own version of Python. For those who want full control on the execution process, requires that you install Python on your own.

(.... to be updated in the next days)


## 4. Changelog

:new: **Update (18 March 2024).** :new: 
New loadbar, more accurate. Useful for slow connections

:new: **Update (18 March 2024).** :new: 

My own experience as a user and the feedback from some of other early birds identified these areas of improvement:
- Automation in the creation of galleries. In v0.6 you had to assign everything manually
- Limitation on the size. What to do with more than 100 artworks, halls became too big.
- Lighting was very limited and realism required baking the textures which is not simple

so the developemnt direction had to go in the line of:
a) Full automation. Just pass over the contents of the galleries and the code should figure out how to distribute it
b) Scalability. Handle large galleries. More than 100 items was leading to huge galleries where all the inner space was unused.
c) Better native materials and lights. Baking textures gives a great visual aspect but is a pain in the ass and not easy to automate

In view of this I decided to do these main design changes:
- Remove room geometry by drawing primitives. I had the code written to incorporate internal panels in the hall but that would have been very difficutl to scale. Then only glb files are imported, either as full galleries or as spaces were items can be placed.
- For template glbs the json file would have the location of each item and the main engine would place these items in the empty template.

This has the advantage of designing very different templates. Most users will not want to deal with that, so a default template is provided. Actually 3 templates: one for the entrance hall, an exhibition hall with internal pannels and without them.

As a plus I added support for native node Babylon materials (wonderful Babylon team !!!) that are vey light and make it very easy to radically change the aspect of the galleries.


:new: **Update (22 December 2023).** :new: 

Touch devices are now detected and better supported. Instruction on how to move around on the initial screen. Info field when hovering on the artwork.
Im starting to do gallery designs. See below.

:new: **Update (22 August 2023).** :new: 

consistency updates in the repository 

:new: **Update (25 June 2023).** :new: 

Great visual improvement aspect of automatic galleries. The materials for the walls and floor are now on a style.json file. Less parameters hardwired into the code. More general way to generate the doors, they are one additional item in the north wall. Light position is dynamically adapted to the dimensions of the hall. White frames for the artworks.

:new: **Update (12 May 2023).** :new: 

An existing .glb template (hall) can now be populated with existing place-holders. This enables high-quality rendering and/or texture baking while the asset remain in the server and are loaded in real time.

:new: **Update (5 March 2023).** :new: 

ON-the-fly built incorporated. If the .glb objects are not available the code will try to build the hall from scratch based on the images. Of course the images and materials need to be available in the web server.





## FAQ

-	Could lights/shadows be incorporated? The best way to do that would be generating the halls with blender and bake (precalculate) the textures.


## TODO

- [ ]	Alternative hall templates, not simply a rectangular hall.
- [ ] Support for VR devices
- [ ] Code to detect overlapping artwork or erroneous configurations
- [ ] Support for lightmaps.  I have some experiments baking lightmaps, you can check them in this youtube [video](https://www.youtube.com/watch?v=mZzMPlagnQk)
- [x] On the fly rendering of the hall and items (pure babylon.js)
- [x] Hybrid mode where you load a glb with the hall but the items are loaded in real time
- [x] A blender based hall builder with textures baked manually.
- [X]	Better management of mobile devices
- [X]	Framing for artwork
- [X]	Titles and information for the artwork




