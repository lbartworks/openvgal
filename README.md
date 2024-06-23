https://github.com/lbartworks/openvgal/assets/121262093/517b6b67-7a87-4f2c-8166-b5c9314ff9e9


# OpenVgal v1.1


 (Open source Virtual Gallery)
Virtual 3D gallery for art showcase. Based on Babylon.js



-----------------------------------------

OpenVgal started in June 2022 as a personal project to provide myself, or anyone, a way to build an interactive 3D virtual gallery programmatically. What this means is that you do not need to design the hall or halls of the galleries, or deal with the 3D work, or the browser code to move around it. You just need organize your collections in folders and run some code provided here.  I was inspired by what Oncyber was creating but they had not open sourced the project. 

A demonstration of the gallery can be seen here:
[https://nostromophoto.com/virtual/virtual.html](https://nostromophoto.com/virtual/virtual.html)

At the current stage the effort/skills have dropped from v0.1 but it is not a one-click process. I plan to create a youtube tutorial if there is demand for it. This is currently needed to use Vgal:

* A web server to host the final virtual gallery/ies

* A working installation of python to generate the .json file

* (advised) A local webserver to do the tests.

🎨 If you want to create your own galleries you can go directly to the [How to create your gallery](#4-steps-to-create-a-gallery) section. Currently there is no video tutorial but I can create if there is demand for it. 



🛠️  If you want to contribute or further develop, the following sections explain some of the internal working of the code. You may look at the TODO list

🙏 If you want to support this development and/or want to collect some of my artwork, you can see my NFTs here:
[https://opensea.io/LB_Artworks](https://opensea.io/LB_Artworks)
  You can also purchase the Kraken gallery to use in inside Oncyber:
[Kraken gallery in Rarible](https://rarible.com/token/0x449f661c53ae0611a24c2883a910a563a7e42489:181)

### SHORTCUTS
👉 To create your own virtual gallery [click here](#1-steps-to-create-a-gallery)

👉 To learn about the structure of OpenVGal [click here](#2-structure-of-openvgal)

👉 To learn how to customize OpenVgal [click here](#3-customize-openvgal)

👉 To see the changelog [click here](#4-changelog)

*Disclaimer:* I am not an expert in javascript or Babylon.js. If you find parts of the code that can be written in a more academic way, feel free to help.



## 1. Steps to create a gallery
In the following steps you can re-create a working example with the files/artwok I provide. Once you make it work, you can proceed to create it with your own files/artwork. The two main elements of OpenVGal are a `building_v2.json` file that describes the content and structure of the galleries and a visualization engine. In the first steps we shall use the building_v2.json provided in the repository. In a second step, we will recreate it and in a third step you can recreate it with your own artwork.
### 1.0 Preparatory work

1. If you do not have a working python installation with jupyter notebooks, install it. You can go to the [Anaconda website](https://www.anaconda.com/products/distribution)
2. Install a local webserver. A simple and light option available in different operative systems is [Devd](https://github.com/cortesi/devd). If you do not want to compile it you can download a portable version [here](https://www.downloadcrew.com/article/33851-devd). Once you download it, uncompress it and place it in some folder you fancy. You can run it from the command line with the command `"devd -ol ."` (the double quotes are not needed). To access the server, if devd does not open automatically a web browser, simply type in your browser http://devd.io. Despite the devd.io domain, this actually points to your localhost.
3. Download or clone the openvgal repository. For consistency, put it inside the local webserver folder. The local webserver would look like:

<p align="center">
<img src="https://github.com/lbartworks/openvgal/assets/121262093/6b93f93a-3240-45d5-8cba-7579a3cdc90f"
">
</p>

4. Download this [zip file](https://mega.nz/file/ThxWUJqJ#dFo9w7eMpXGKTGHbFG9RM8AeEB8UIrOHBVfurwaNoZs) with example galleries. Uncompress the zip archive <u>in the openvgal folder</u>. You will notice that 6 folders (gallery1, gallery2, gallery3, gallery4, gallery5 and gallery6) will be created. This example has, hence, 6 art halls. 

### 1.1 Verify that default options work
5. Verify that all works navigating to `openvgal/virtual_gallery.html`. You should see OpenVGal in your browser and you can navigate the 6 galleries by clickin on the doors. You can return to the hub hall by clicking on doors with the "Entrance" sign written.
6. If it would not work, review the steps and check the console errors in the browser.

### 1.2 Recreate building_v2.json with the given galleries
6. Next step is to recreate the .json file. Delete the file `openvgal/building_v2.json` and restart the web server (close it and open it again to make sure the cache is cleared). The goal of the next steps is to verify that the code to build up the .json file works properly

7. Run jupyter notebook in Anaconda and load the notebook `python/VR_gallery.ipynb`. This notebook will create the [buliding_v2.json](building_v2.json) file. If you follow these instructions you do not need to change the paths.  Run the notebook until you get to the optional parts, and everythig goes well a fresh `buliding_v2.json` will be created at the web server root folder. You may see a warning concerning  `UserWarning: Truncated File Read warnings.warn(str(msg))`. You can ignore it.

8. Verify that it works. It should merely reproduce what was seen in step 5

### 1.3 Create your own galleries

9. Organize each of the artwork images for each art hall on a different folder. Put all the images (1 Mpix advised) of each hall in one folder. Similarly to the example, where the folder gallery1 contains the artworks that later will be shown in the same art hall.
10. Create a spreadsheet (see [example](python/building_v2.csv)) with the .csv fields and save it. You need to assign a gallery name (preferrably not very long) to each folder with images. That will be the name displayed on the door. You can overwrite the existing csv file for simplicity. Remember that, for the moment, all galleries need to be parented by the root gallery. If the folder contains a large number of images (hundreds), the python code will break it up in smaller art halls automatically.

11. Run again the [VR_gallery.ipynb](python/VR_gallery.ipynb) notebook. If you simply overwrote the .csv file you do not need to customize any folder. The first lines of the notebook contains some variables for customization. After running it, a new building_v2.json should be created. Notice that if the number of artworks is larger than the max template hall capacity the code will automatically create linked galleries.

12. You may want to customize your `materials/logo.png` file to show in the hub hall. Use the existing one as a reference for size.

### 1.4 Deploy on a public web server
13. Customize the variables in the `gallery_viewer.html` file depending on the folder where you placed the files in the web server.

```
	const glb_location='/openvgal/templates/';
	const config_file_name='/openvgal/building_v2.json';
	const materials_folder='/openvgal/materials';
	const hallspics_prefix= '/openvgal';
	const icons_folder='/openvgal/icons';
	
	const aux_javascript= '/openvgal/room_builder_aux.js';
```
Upload the files to the web server. Check the console in case of error. Most common errors are related to files not found due to changes in the variables above.

14. One final step is to fix the BJS_ materials. They are json file that unfortunately do not support yet relative links. The existing ones will search the textures in the dvd.io domain, that obviously will not work. To update the BJS_ materials you can see in the Optional area of `VR_gallery.ipynb` a small piece of code to update the BJS_ files before uploading them to the server.

## 2. Structure of OpenVGal

The project is structured around three key elements:
-	A json file that describes the structure and content of the gallery halls.
-	Hall templates in the form of .glb files. Glb files is the binary version of [GLTF](https://en.wikipedia.org/wiki/GlTF), an open format to describe 3D scenes and models. Each template should be consistent with the VR_Gallery.ipynb python code to properly display the items.
-	A gallery visualizer that creates the virtual experience using a web browser

OpenVgal uses a *building_v2.json* file to describe the structure of galleries (_v2 aims to avoid confusion with the older versions) The format is aimed to be flexible enough to accommodate a single hall or interconnecting halls in an arbitrary structure (not completely arbitrary at the moment). It always starts with a root gallery hub hall. Each hall can have items. Items are: either an artwork (a picture) or a door connecting to another gallery. In this version hub halls can only have doors and artwork halls can have artworks and 1 or 2 doors.

The *building_v2.json* file follows a nested structure of dictionaries (dictionary is understood here as a data structure organized in the form of [name/value pairs](https://www.w3resource.com/JSON/structures.php)). 
The highest level structure (level 1) lists all the halls in the gallery.



#### Example of the level 1 structure:

```
{
“root”: root_dictionary,
“another_hall”: hall_dictionary,
…
“last_hall”: hallN_dictionary
h}
```

The `root_dictionary` or the `hallN_dictionary` are level 2 dictionaries describing the characteristics of the hall. Each level 2 dictionary  has three compulsory keys in the dictionary: 

* A **parent** field with the hall name that will give access to it. Note that the root hall has “none” as parent.
* A **resource** field with the name of a .glb file. Normally the file selected here will not exist and fall back to the next field. If it exist it will override any subsequent information about the items. It should be a fully designed gallery, including all the artworks.
* A **template** field with the name of a template .glb file. A template .glb file with start with "T_" and it simply contains an empty hall where the artworks will be placed.
* In addition to the three compulsory keys, it will have additional keys with the contents (items) of the hall.

#### Example of the level 1 and level 2 structure:
```
{
“root”:{
	“parent”: “none”,
	"resource": "root.glb",
	"template": "T_root.glb",
	“item1”:{…},
	“item2”: {…},
	“last item”: {…},
},
“another gallery”:{…},
“yet another gallery”: {…},
…
“last gallery”: {…}
}
```
Each of the **items** (`item1`, `item2`, etc...) consist of a level 3 dictionary with the following compulsory keys:
* A resource key with the path to the file containing either the picture or the gallery (a .glb file)
* A resource_type key that can have two values: [“door” | “image”]
width. 

In the case of resource_type=image, this additional keys are needed:
* A width and height key. They have values between 0 and 1. Depending on the aspect ratio, either the width or the height are expected to be equal to 1 and the other one lower than 1.
* A location key with 3 values containing the x,y,z position of the center of the item. Notice that here the "up" direction is the Z axis.
* A vector key with 2 values (x,y) that define a normal vector that identifies the orientation of the artwork (where does it face, to put in simple terms).
* A metadata key with text. That text will be shown when you hover on the artwork


#### Example of the level 1, 2 and 3 dictionaries:
```
{
“root”:{
	“parent”: “none”,
	"resource": "root.glb",
	"template": "T_root.glb",
	“another_gallery”:{
	   "resource": "another.glb",
       "resource_type": "door",
	},
	“item2”: {…},
	“last item”: {…},
},
“another gallery”:{
	“parent”: root,
	"resource": "another.glb",
	"template": "T_pannels.glb",
	"item1":{
	   	"resource": "gallery1/item1.jpg",
		"resource_type": "image",
	   	"width": "1.00",
       		"height": "0.74",
       		"location": "[15.0, -14.62573121343933, 2.0]",
       		"vector": "[-1.0, 0.0]",
       		"metadata": "ID #0 Beach bike"
	},
	“item2”: {…},
	“last item”: {…},
},
“yet another gallery”: {…},
…
“last gallery”: {…}
}
```

At the bottom the file contains a technical section:
```
  "Technical": {
    "ambientLight": 0.5,
    "pointLight": 50,
    "scaleFactor": 2.5,
    "verticalPosition": 0.4
  }

  ```
Small inconsistencies in this structure will be address in the next update of OpenVgal

## 2.1 Json file creation

Although it is possible to get the `building_v2.json` file created manually, as soon as several halls are interconnected with a few tens of items, this will not be practical. As an alternative a python jupyter notebook is provided to generate the .json file based on a more intuitive .csv file The csv file will get the following fields or columns:

* Gallery name (name of the hall)

* Parent (hall name of the parent. "none" for the root)

* Folder (local filesystem folder with all the images of the hall)




	


## 2.2. Gallery viewer

The gallery viewer is an html page with javascript code to start the babylon engine and handle the following tasks:
- Read the `building_v2.json` file and create the root hall. For the root hall, or any other hall:
	- 	First it will try to to pull from the server a glb file with the name of the "resoure" field
 	- 	If it does not exist, it will try to pull up a glb file with a template version ("T_" prefix) of the "resource" field
  	-	If none exist is will create an error	 
- Creaate a kebyboard controller and camera to navigate the galleries in a first-person shooter style. You can rotate with the mouse and move in the four directions with the arrow keys. Tries to detect touch devices and adapt accordingly.
- Create an event listener for each door in a hall. When the visitor hovers on those doors the mouse icon changes. The user can teleport from one hall to another by clicking on the door
- If the user chooses another hall, the code pulls up in the background the .glb file and show a progress bar screen.
- Swap the scene contents but keep in memory the previous halls for faster interaction if the user returns to previously visited halls.


 

## 3. Customize OpenVGal
Openvgal default files provide a robust way to represent a large number of galleries and artwork. However, proficient programmers or designers would like to take it on step further. These are the customization options available from simpler to more complex

### 3.1 Customize materials
The templates used for the root hall or the art galleries have some BJS_ materials are pulled from the server (rather than embedded). In this way if you update the material contents in the server, you update the style. Note that you could customize and radically change the aspect of the galleries just with the materials.

### 3.2 Create new templates
OpenVgal provides currently 3 templates (T_root, T_pannels, T_nopannels) that act consistently with the VR_gallery.ipynb python code. You can add some non-structural element to the given templates and all should work fine. If you want structurally different galleries, you would need additionally a python object consistent with those new templates. To create new templates you would need the following steps:

FOR HUB HALLS

- New glb files with:
	* meshes for the doors named "d_0", "d_1", etc...
	* pointLight sources to be used later in Babylon. This simply fixes the position of the light, not the intensity. Notice that performance is affected as more lights are added.
	* Either normally embedded materials or materials with the prefix name "BJS_". In that case the gallery viewer will try to pull the material from the server.
- If the template has more than 10 doors you will need to modify the `doors_root=10` variable in `VR_gallery.ipynb`

FOR ARTWORK HALLS
- New glb files with:
	* meshes for the doors named "d_0", "d_1", etc... Meshes preferrably having a single plane.
	* pointLight sources to be used later in Babylon. This simply fixes the position of the light, not the intensity. Notice that performance is affected as more lights are added.
	* Either normally embedded materials or materials with the prefix name "BJS_". In that case the gallery viewer will try to pull the material from the server.
- A python classs equivalent to `class GalleryWithOptionalPanels` that you can see in the `VR_gallery.ipynb` file. The object must implement the following interfaces:
	* a `max_capacity()` function that returns the maximum number of artworks the template/s can accomodate
	* a `solve_gallery(N)` function that returns positions, vectors, template_gallery. The last one is a string with the corresponing .glb file. Notice that the same object can handle different templates, for example: for a small number of artworks (N), choose a small template, otherwise choose a larger one.


### 3.3 Create a full gallery
OpenVgal supports that you load directly a fully configured .glb file.


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




