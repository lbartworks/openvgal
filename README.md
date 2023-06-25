https://github.com/lbartworks/openvgal/assets/121262093/20b033a0-1287-4b3e-b937-0c9155014fa9



# OpenVgal v0.4


 (Open source Virtual Gallery)
Virtual 3D gallery for art showcase. Based on Babylon.js

:new: **Update (25 June 2023).** :new: 

Great visual improvement aspect of automatic galleries. The materials for the walls and floor are now on a style.json file. Less parameters hardwired into the code. More general way to generate the doors, they are one additional item in the north wall. Light position is dynamically adapted to the dimensions of the hall. White frames for the artworks.

:new: **Update (12 May 2023).** :new: 

An existing .glb template (hall) can now be populated with existing place-holders. This enables high-quality rendering and/or texture baking while the asset remain in the server and are loaded in real time.

:new: **Update (5 March 2023).** :new: 

ON-the-fly built incorporated. If the .glb objects are not available the code will try to build the hall from scratch based on the images. Of course the images and materials need to be available in the web server.

-----------------------------------------

Open Vgal started in June 2022 as a personal project to provide anyone a way to build a virtual gallery programmatically. What this means is that you do not need to design the hall or halls of the galleries, or deal with the 3D work, or the browser code to move around it if you do not want. You just need to describe the dimensions of the halls and the folders with the artwork images. 

A demonstration of the gallery can be seen here:
[https://nostromophoto.com/virtual/virtual.html](https://nostromophoto.com/virtual/virtual.html)
At the current stage you still need some effort/skills to create it. I hope it gets simplified in the following versions and with the help of the community. This is currently needed to use Vgal:
-	A web server to host the final virtual gallery/ies
-	(optional) A working installation of python to generate the .json file
-	A local webserver to generate the galleries and do the tests

🎨 If you want to create your own galleries you can go directly to the [How to create your gallery](#recommended-steps-to-create-a-gallery) section. Currently there is no video tutorial but I can create if there is demand for it. 

🛠️ If you want to contribute or further develop the following sections explain some of the internal working of the code. You may look at the [TODO list](#todo)

*Disclaimer:* I am not an expert in javascript or Babylon.js. If you find parts of the code that can be written in a more academic way, feel free to help.

## 0. Structure of Open Vgal

The project is structured around three key elements:
-	A json file that describes the structure and content of the gallery halls.
-	A gallery builder that creates .glb files for each hall. Glb files is the binary version of [GLTF](https://en.wikipedia.org/wiki/GlTF), an open format to describe 3D scenes and models. Each hall will have its own file to avoid having a single very large file.
-	A gallery visualizer that creates the virtual experience using a web browser

Open Vgal uses a *building.json* file to describe the structure of galleries. The format is aimed to be flexible enough to accommodate a single hall or interconnecting halls in an arbitrary structure (not completely arbitrary at the moment). It always starts with a root gallery hall. That one can be a single gallery hall with artworks or you can have a gallery hall that connects with sub-galleries. Each hall can have items. Items are: either an artwork (a picture) or a door connecting to another gallery. 

The *building.json* file follows a nested structure of dictionaries (dictionary is understood here as a data structure organized in the form of [name/value pairs](https://www.w3resource.com/JSON/structures.php)). 
The highest level structure (level 1) lists all the halls in the gallery.



#### Example of the level 1 structure:

```
{
“root”: root_dictionary,
“another_hall”: hall_dictionary,
…
“last_hall”: hallN_dictionary
}
```

The `root_dictionary` or the `hallN_dictionary` are level 2 dictionaries describing the characteristics of the hall. Each level 2 dictionary  has two compulsory keys in the dictionary: 

- A `geometry` list (or array) that describes the geometry and dimensions of the hall, which will have a rectangular shape. The list contains the numberical values correspoing to [width, length, wall_height, #items north wall, #items south wall, #items west wall, #items east wall].
- A `parent` field with the hall name that will give access to it. Note that the root hall has “none” as parent.

In addition to the two compulsory keys, it will have additional keys with the contents (**items**) of the hall. 

#### Example of the level 1 and level 2 structure:
```
{
“root”:{
	“geometry”:[…],
	“parent”: “none”,
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
Each of the **items** (`item1`, `item2`, etc...) consist of a level 3 dictionary with the following keys:
- 	A `resource` key with the path to the file containing either the picture or the gallery (a .glb file)
- 	A `resource_type` key that can have two values: [“door” | “image”]
- 	`width`. For gallery type describes the dimension of the door. For images it will have values between 0 and 1.Depending on the aspect ratio, either the width or the height are expected to be equal to 1 and the other one lower than 1.
- 	`height`. Same as previous.

#### Example of the level 1, 2 and 3 dictionaries:
```
{
“root”:{
	“geometry”:[…],
	“parent”: “none”,
	“item_name” : {
		“resource”: "another gallery.glb",
		“resource_type”: “door”,
		“width”:1,
		“height”: 2
	},
	“item2”: {
		“resource”: "galleryfolder/masterpiece.jpg",
		“resource_type”: “image”,
		“width”:1,
		“height”: "0.7"
	},
	“last item”: {…},
},
“another gallery”:{…},
“yet another gallery”: {…},
…
“last gallery”: {…}
}
```

At the bottom the file contains a technical section:
  "Technical": {
    "ambientLight": 1,
    "pointLight": 20,
    "scaleFactor": 3,
    "verticalPosition": 0.4
  }

## 1. Json file creation

Although it is possible to get the `building.json` file created manually, as soon as several halls are interconnected with a few tens of items, this will not be practical. As an alternative a python jupyter notebook is provided to generate the .json file based on a more intuitive .csv file
The csv file will get the following fields or columns:
- Gallery name (name of the hall)
- Parent (hall name of the parent. "none" for the root9
- Folder (local filesystem folder with all the images of the hall)
- Width (of the hall)
- Length (of the hall)
- Height (of the hall walls)
- #items in the north wall
- #items in the sounth wall
- #items in the wwest wall
- #items in the east wall

Notice that despite the notebook must know the complete local path of the images, it will only include the file name in the .json file.

	
## 2. Gallery builder

The gallery builder consists of html/javascript code that takes as an input the `bulding.json` file and creates binary (.glb) files. One file for each hall. It runs as a local web page (.html) and uses the rendering and export capabilities of Babylon.JS. From a programming point of view it would probably make more sense to create a node.js program. It is easier to install a lightweight web server than node.js, and that is the reason for the provisional choice.

Most of the job is done at the `rb(config_file, room_name, scene)` subroutine. It will create first the floor and walls of the hall. The information is obtained from the geometry contanined in `building.json`. Currently some parameters at the beginning of the subroutine are fixed:
```
	let door_height=3;		// dimensions of the door to the parent gallery
	let door_width=2;
	let item_separation=0.1; 	//this prevents that items and walls are co-planar		
	let item_size=2;		//parameter controlling the scale of the items
```
They control the size of the parent doors, as well as a general scale parameter for the items. 

The materials for floor and walls are read from the styles.json. The textures are available in the repository (/materials folder). Then it will go through all the items in the hall (doors or artworks) and will create planes with one of these two materials:
- a plain color + text for the doors
- a texture with the images of the artwork

All the halls, except the root one, will have an additional item always: the door to get back to their parent hall.

Depending on the size of the halls and the number of them, there may be some issues with the file size or the memory usage. Halls of less than 50 images (1M pix resolution aprox) have worked well so far. 
Notice that with the addition of "on-the-fly" generation the role of the gallery builder is secondary. See next section.


## 3. Gallery viewer

The gallery viewer is an html page with javascript code to start the babylon engine and handle the following tasks:
- Read the `building.json` file and create the root hall. For the root hall, or any other hall:
	- 	First it will try to to pull from the server a glb file with the name of the "resoure" field
 	- 	If it does not exist, it will try to pull up a glb file with a template version ("T_" prefix) of the "resource" field
  	-	If none exist is will generate it on the fly 	 
- Creaate a kebyboard controller and camera to navigate the galleries in a first-person shooter style. You can rotate with the mouse and move in the four directions with the arrow keys.
- Create an event listener for each door in a hall. When the visitor hovers on those doors the mouse icon changes. The user can teleport from one hall to another by clicking on the door
- If the user chooses another hall, the code pulls up in the background the .glb file and show a progress bar screen.
- Swap the scene contents but keep in memory the previous halls for faster interaction if the user returns to previously visited halls.

The glb files can be generated with the Gallery builder or any other software. In the latter case, you need to follow this convention:
- If the glb file is a full gallery (no "T_" prefix), the mesh representing the door will have a name with the form "d_XXX", where XXX is the hall to which the door takes you (d_root for the main hall)
- If the glb file is a template gallery, i.e. it only misses the textures of the artworks:
	- you must create a door mesh and name is as in the previous point
  	- you must identify the planes where to put the textures by naming them YYYYYY_N, where "YYYYYY" will be the name of the resource (image name) and "N" a sequence number.

The gallery shown on the video or in my website has one main (root) hall created in Blender and with all textures baked. The other 6 galleries are generated on the fly. I also have a template GLB file created with Blender (not updated in this repo yet).

 
## 4. Steps to create a gallery: (This is a tutorial from v0.1, some aspects may need some review).
### 4.0 Preparatory work
1. Organize each of the artwork images for each hall on a different folder. Put all the images (1 Mpix advised) of each hall in one folder. If you do not want to use your own files, I provide a zip file with examples.
2. Create a spreadsheet (see [example](building.csv)) with the .csv fields and save it. You can follow along with that csv file and the example halls.
3. Install a local webserver. A simple and light option available in different operative systems is [Devd](https://github.com/cortesi/devd). If you do not want to compile it you can download a portable version [here](https://www.downloadcrew.com/article/33851-devd). Once you download it, uncompress it and place it in some folder you fancy. You can run it from the command line with the command `"devd -ol ."` (the double quotes are not needed). To access the server simply type in your browser http://localhost.
5. If you do not have a working python installation with jupyter notebooks, install it. You can go to the [Anaconda website](https://www.anaconda.com/products/distribution)
6. Download or clone the vgal repository. For consistency, put it inside the local webserver folder. The local webserver would look like:

<p align="center">
<img src="https://user-images.githubusercontent.com/121262093/212482584-acf41f9e-6620-4e4c-b9bf-16beaf7a1a81.png">
</p>

7. If you want to use the example galleries, download this [zip file](https://mega.nz/file/mko2zKAR#P_5nhIO2CCpOEJ3qL9euduRySfu9iMsBgWJEOcYpWGs). Uncompress the zip archive in the vgal/python folder. You will notice that 4 folders (gallery1, gallery2, gallery3 and gallery4) will be created. This example has, hence, 4 halls. If you want to create your own halls you will need to replace these folder with you own folders.

Json file creation

7. Run the jupyter notebook and load the notebook [VR_gallery.ipynb](VR_gallery.ipynb), which should be in the vgal/python folder. This notebook will create the [buliding.json](building.json) file. If you follow these instructions you do not need to change the paths. In case the `building.json`file or the gallery folders are in different locations you can customize the first variables of the notebook (see below). Run the notebook nd everythig goes well a fresh `buliding.json` will be created at the web server root folder.

```
	csv_file='building.csv'
	output_file="../../building.json"
	image_types=('jpg', 'jpeg', 'png', 'tif')
	csv_separator=';'
```

In the following steps there are three possible options: to create a fully configured glb file (hall and artwork) with Babylon, to create a glb file (just the hall plus placeholders for the artwork) with some 3D tool, or do not create any glb file and render everything on the fly. The following 3 subsections discuss the 3 options

### 4.1 Hall builder (create a full glb file with babylon)

8. If you do not have a web browser open already, do it and type in http://locahost. Navigate to the hall builder (if you follow along this installation it would be [/vgal/hall_builder/room_processor.html](room_processor.html). Upon loading, if all goes well, the page will inform that 5 halls are created (the root hall and the 4 gallery halls). Their corresponding files will be downloaded. The first javascript section of the html file has some variable to customize the location of the input / output files (see below)

```
	const config_filename='/building.json';
	const hallspics_prefix= '/vgal/python';
	const materials_folder='/vgal/materials';
```
10. If it does not work you can have a look at the console to figure out what went wrong
11. The downloaded files will be placed by the browser in the download default folder of your computer. You will need to manually move the 5 .glb files to the local webserver folder. Note that if you run the download several times, the filenames may no longer be the intended ones (for example root(1).glb instead of root.glb). Those names will not be recognized later, so either rename them or flush the download folder and run it again.

```
	const asset_location="/";
	const config_file_name="/building.json";
```
13. Optionally you can check with the [babylon sandbox](https://sandbox.babylonjs.com/) that the halls show up as expected.

### 4.2 Hall template (create a glb hall with placeholders with some 3D tool)
The previous option comes with some drawbacks like the large size of the glb files and the limitations of Babylon to create scenes compared to other 3D modelling tools like Blender. As an alternative:
- You can use blender to design a higher quality hall. That can include baked textures for a more efficient way to include complex lighting.
- You can include placeholders for the artwork. The gallery viewer will retrieve the images and render them in the placeholders

In order to work in the way, this is necessary:
- The `resource` glb file will need to have the T_ prefix. If the gallery viewer detects a hall resource with such prefix it will not include any element or material except the textures of the placeholders
- The placeholders will need to be named using the same criterion of option 4.2 (ImageName + "_" + number)

The gallery Antarctica (https://nostromophoto.com/virtual/gallery_viewer/virtual_gallery.html) has been generated in this way. You can also check the blender file with python code to create the hall and placeholders. Notice that you would need to manually bake the textures. This options is only advised for seasoned Blender users.

### 4.3 On the fly creation (no glb file)
The third and easiest option is to simply skip steps 4.1 and 4.2 and DO NOT create a glb file. The gallery_viewer will create the hall on the fly completely using the information from the json file. 

The galleries "Pakistan" and "PeruBolivia" are created in this way. Notice that the images (your artwork) will need to be uploaded into the server. You will need to configure the header parameters in the `gallery_viewer.html` file.

### 4.4 Visualize the gallery

12. Open another web browser tab and go to http://localhost/vgal/gallery_viewer/virtual_gallery.html. 
13. Again the first javascript lines contain code with path options in case that the `buliding.json` or the .glb files are placed in a different location.
14. If all goes well you should be able to navigate the virtual root hall and jump into the additional halls

### 4.5 Upload it to the internet

15. Finally if you want anyone to see the contents, you will need to make them available into your own managed server or via a hosting service. Notice that the large files may be rejected by some suppliers (I found some have 10 MB size limits for each file).

## FAQ
-	Can the items be larger? Currently the width/height comes as a relative factor on a global size hardcoded in javascript (details)
-	Could lights/shadows be incorporated? The best way to do that would be generating the halls with blender and bake (precalculate) the textures. 


## TODO
- [x] On the fly rendering of the hall and items (pure babylon.js)
- [x] Hybrid mode where you load a glb with the hall but the items are loaded in real time
- [x] A blender based hall builder with textures baked manually.
- [ ] A blender based hall builder with baked textures automated.
- [ ]	GUI to interactively get all the inputs and get visual feedback of the appearance.
- [X]	Customization of materials via input files
- [ ]	Alternative hall templates, not simply a rectangular hall.
- [ ]	Better management of mobile devices
- [X]	Framing for artwork
- [ ]	Titles and information for the artwork
- [ ]	Support for VR devices
- [ ] Code to detect overlapping artwork or erroneous configurations
- [ ] Baking lightmaps
