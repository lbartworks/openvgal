import json
import glob
import re
import pandas as pd
import os
import math
import numpy as np
import sys
from PIL import Image, ExifTags
import argparse
import warnings
warnings.filterwarnings("ignore", message=".*Truncated File Read.*")

## constants

image_types=('jpg', 'jpeg', 'png', 'tif')

 
#code to distribute items
class GalleryWithOptionalPanels:
    #default panel length L/4
    def __init__(self, W=30,L=60, panel_length=60/4):


        panel_position_x=W/5
        panel_position_y=L/4
        # panel_length=L/4
        panel_thickness=0.5
        item_height=2
        free_space=0.75
        item_max_size=2.5
        min_spacing=3
        door=1
        

        self.geometry={"W": W, "L":L , "item_height": item_height, "panel_position_x": panel_position_x, "panel_length": panel_length, 
                "panel_thickness": panel_thickness,"free_space":free_space, "item_height": item_height, "panel_position_y":panel_position_y,
                "min_spacing":min_spacing, "item_max_size": item_max_size}

        #the saturation self.density is the inverse of the spacing
        self.densitity_saturation=1/self.geometry["min_spacing"]

        long_wall=(L-free_space*2)
        short_wall=(W/2-door/2-free_space*2)
        panel=max(0.1,panel_length-free_space*2)

        Lengths1=[long_wall,short_wall,short_wall,long_wall,short_wall,short_wall ]
        Lengths2=[panel, panel, panel, panel, panel, panel, panel, panel]
        self.Lengths=Lengths1 + Lengths2

        if (item_max_size> min_spacing):
            print(f'ERROR: The item size cannot be larger than the spacing')
       
        

    def assign_occupancy(self, N, silent=True):
        #fills-in assignments, ie in what place each item will be located
        
        occupancy_max=np.floor( (np.array(self.Lengths)- self.geometry["item_max_size"])/self.geometry["min_spacing"]+1)
        self.occupancy=occupancy_max*0
        self.panels_off=True

        #initialize the panels
        self.occupancy[6:]=occupancy_max[6:]
        self.density=self.occupancy/self.Lengths
        self.density[occupancy_max==0]=999
        self.assignments=np.arange(N)
        success=1
        for i in range(N):
            #fallback case 1: populate all the empty spaces
            if 0 in self.density:
                chosen=np.where(self.density==0)[0][0]
                self.assignments[i]=chosen
                self.occupancy[chosen]=1
                self.density[chosen]=self.occupancy[chosen]/self.Lengths[chosen]
                continue
            
            #fallback case 2: populate wall till based on density till saturation
            #if np.min((self.occupancy+1)/self.Lengths)<=self.densitity_saturation:
            if np.max(occupancy_max-self.occupancy)>0:
                chosen=np.argmax(occupancy_max-self.occupancy)
                self.assignments[i]=chosen
                self.occupancy[chosen]=1+self.occupancy[chosen]
                self.density[chosen]=self.occupancy[chosen]/self.Lengths[chosen]
                continue
            
            #fall back case 3: open the panels
            if self.panels_off and (self.geometry["panel_length"]!=0):
                self.panels_off=False
                self.occupancy[6:]=0
                self.density=self.occupancy/self.Lengths
                chosen=np.argmax(occupancy_max-self.occupancy)
                self.assignments[i]=chosen
                self.occupancy[chosen]=1
                self.density[chosen]=self.occupancy[chosen]/self.Lengths[chosen]
                continue
                
            if not silent:
                print (f'ERROR: {i} item could not be assigned with the constraints given')
            success= -1
            break
        return success
    
    def max_capacity(self):
        i=1
        result=self.assign_occupancy(i)

        while (result==1):
            i=i+1
            result=self.assign_occupancy(i)
        return i-1
            
    def solve_gallery(self,N):
        #returns the item location xyz coordinates in an array of dictionaries + a string with the .glb template

        result=self.assign_occupancy(N, False)
        if result==-1:
            return [], []
        
        vect_n=[0,1]
        vect_s=[0,-1]
        vect_w=[-1,0]
        vect_e=[1,0]
       
        #go through each area
        positions=np.zeros((N,3))
        vectors=np.zeros((N,2))
        for i,Length in enumerate (self.Lengths):
            #get the assignment position
            walln_assigns=np.where(self.assignments==i)[0]
            #find the algorithm for each wall
            spacing=Length/(self.occupancy[i]+0.0001)
            match i+1:
                case 1:
                    initial=-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[self.geometry["W"]/2,initial +j*spacing,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_w
                case 2:    
                    initial=self.geometry["W"]/2-self.geometry["free_space"]-spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[initial-j*spacing,-self.geometry["L"]/2,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_n
                case 3:    
                    initial=-self.geometry["W"]/2+self.geometry["free_space"]+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[initial+j*spacing,-self.geometry["L"]/2,self.geometry["item_height"]]   
                        vectors[walln_assign,:]=vect_n                 
                case 4:
                    initial=-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[-self.geometry["W"]/2,initial +j*spacing,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_e
                case 5:    
                    initial=self.geometry["W"]/2-self.geometry["free_space"]-spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[initial-j*spacing,self.geometry["L"]/2,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_s
                case 6:    
                    initial=-self.geometry["W"]/2+self.geometry["free_space"]+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[initial+j*spacing,self.geometry["L"]/2,self.geometry["item_height"]]   
                        vectors[walln_assign,:]=vect_s
                case 7:    
                    initial=self.geometry["panel_position_y"]-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[-self.geometry["panel_position_x"]+self.geometry["panel_thickness"]/2, initial+j*spacing,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_e
                case 8:    
                    initial=self.geometry["panel_position_y"]-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[self.geometry["panel_position_x"]-self.geometry["panel_thickness"]/2, initial+j*spacing,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_w
                case 9:    
                    initial=-self.geometry["panel_position_y"]-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[-self.geometry["panel_position_x"]+self.geometry["panel_thickness"]/2, initial+j*spacing,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_e
                case 10:    
                    initial=-self.geometry["panel_position_y"]-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[self.geometry["panel_position_x"]-self.geometry["panel_thickness"]/2, initial+j*spacing,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_w
                case 11:    
                    initial=self.geometry["panel_position_y"]-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[-self.geometry["panel_position_x"]-self.geometry["panel_thickness"]/2, initial+j*spacing,self.geometry["item_height"]]
                        vectors[walln_assign,:]=vect_w
                case 12:    
                    initial=-self.geometry["panel_position_y"]-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[-self.geometry["panel_position_x"]-self.geometry["panel_thickness"]/2, initial+j*spacing,self.geometry["item_height"]]   
                        vectors[walln_assign,:]=vect_w
                case 13:    
                    initial=-self.geometry["panel_position_y"]-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[self.geometry["panel_position_x"]+self.geometry["panel_thickness"]/2, initial+j*spacing,self.geometry["item_height"]]   
                        vectors[walln_assign,:]=vect_e
                case 14:    
                    initial=self.geometry["panel_position_y"]-Length/2+spacing/2
                    for j,walln_assign in enumerate(walln_assigns):
                        positions[walln_assign,:]=[self.geometry["panel_position_x"]+self.geometry["panel_thickness"]/2, initial+j*spacing,self.geometry["item_height"]]    
                        vectors[walln_assign,:]=vect_e

        if self.geometry["panel_length"]==0:
            template_gallery="T_small.glb"
        elif self.panels_off:
            template_gallery="T_nopannels.glb"
        else:
            template_gallery="T_pannels.glb"
        return positions, vectors, template_gallery


def is_rotated(image):
    try:
        rotate=False
        exif = image._getexif()
        
        if exif is None:
            return rotate
        
        # Inverting the ExifTags dictionary to get names from values
        orientation_key = 274 # The standard key for orientation in EXIF data
        
        if orientation_key in exif:
            if exif[orientation_key] == 6 or exif [orientation_key]==8:
                rotate=True
        
        return rotate


    except (AttributeError, KeyError, IndexError) as e:
        print(f"Error: {e}")
        return rotate
    
def GalleryManager(items, small_threshold=25):
#function to manage your portfolio of spaces based on the number of items
    if items> small_threshold:
        return GalleryWithOptionalPanels()
    else:
        return GalleryWithOptionalPanels(W=30, L=30, panel_length=0)


def main(openvgal_folder, csv_file='building_v2.csv', output_file='building_v2.json', root_template="T_root.glb", doors_root=10):
    """
    The main function creates the .json file that the BabylonJS engine code needs. The direct input is a csv file 
    with a match of sub-gallery - local folder. The indirect input is a Gallery object that creates a distribution
    of the gallery items into existing Blender templates. Those templates and the Gallery object go together.
    """
        
    current_directory= os.path.dirname(os.path.abspath(__file__))
    galleries_folder=openvgal_folder +"/web_server/content"
    csv_separator=','
    df=pd.read_csv(openvgal_folder+ '/python/' + csv_file, sep=csv_separator) 
    
    #create the Gallery object 
    gallery_distribution=GalleryWithOptionalPanels()
    max_items=gallery_distribution.max_capacity()

    #create the underlying variable for the .json file
    building={}

    unique_id=0

    for i,row in df.iterrows():
        son_galleries=sum(df.Parent==df["Gallery name"][i])
        print(f"Processing gallery: {df['Gallery name'][i]}")
        #lets manage the root gallery/ies
        if i==0:
            if df["Gallery name"][i] != "root":
                print('ERROR: The first gallery must be named root (case sensitive). Correct it and run it again')
                break
            if df["Parent"][i]!= "none":
                print("ERROR: The root gallery cannot have parent. Set \"none\" as parent and run it again")
                break

            #no additional root galleries
            if (son_galleries <= doors_root):
                root_galleries=1
                building[df["Gallery name"][i]]={}
                building[df["Gallery name"][i]]["parent"]=df.loc[i, 'Parent']
                building[df["Gallery name"][i]]["resource"]=df["Gallery name"][i] + ".glb"
                building[df["Gallery name"][i]]["template"]="T_root.glb"
                


            #additional root galleries    
            else:
                #minus one because we will need a connecting door
                root_galleries=math.ceil((son_galleries-9)/(doors_root-2))+1
                for j in range(root_galleries):
                    if j==0:
                        building[df["Gallery name"][i]]={}
                        building[df["Gallery name"][i]]["parent"]=df.loc[i, 'Parent']
                        building[df["Gallery name"][i]]["resource"]= df["Gallery name"][i] +".glb"
                        building[df["Gallery name"][i]]["template"]=root_template

                        last_parent=df["Gallery name"][i]
                    else:
                        root_name=df["Gallery name"][i] + "#" +str(j)
                        building[root_name]={}
                        building[root_name]["parent"]=last_parent
                        building[root_name]["resource"]= df["Gallery name"][i] +".glb"
                        building[root_name]["template"]=root_template
                        last_parent=root_name
        else:

            
            if (son_galleries>0):
                print('ERROR: For the moment all galleries must be parented by the root gallery')
                break

            #now the non root galleries. Get the number of items
            files_grabbed = []
            for image_type in image_types:
                files_grabbed.extend(glob.glob(galleries_folder + df["Folder"][i] + '/*.' + image_type))
            num_items=len(files_grabbed)
            if num_items==0:
                print(f'ERROR: The folder ' + galleries_folder+ df["Folder"][i] + ' either does not exist or does not contain any images. Either delete the row from the csv or feed it with images')
                break

            if root_galleries==1:
                last_parent=df.loc[i, 'Parent']
            elif i<=9:
                last_parent=df.loc[i, 'Parent']
            else:
                last_parent=df.loc[i, 'Parent'] +'#' + str(int(np.ceil(  (i-doors_root+1)/(doors_root-2) )))
            
            m=0 #number of subgalleries
            j=0 #counter of items in all the son galleries of this line
            items_left=num_items
            while (items_left>0):
                if (items_left > max_items) or m>0:
                #we need to break it up into several galleries
                    gallery_distribution=GalleryManager(min(items_left,max_items))
                    [distribution, vectors, template]=gallery_distribution.solve_gallery(min(items_left,max_items))
                    
                    if m==0:
                        gallery_name=df["Gallery name"][i] 
                    else:
                        gallery_name=df["Gallery name"][i] + "#" +str(m)
                    building[gallery_name]={}
                    building[gallery_name]["parent"]=last_parent
                    building[gallery_name]["resource"]=gallery_name + '.glb'
                    building[gallery_name]["template"]=template
                    last_parent=gallery_name

                    k=0 #counter of items inside the subgallery
                    
                    for file_name in files_grabbed[j: j+min(max_items, items_left)]:
                        try:
                            
                            im=Image.open(file_name)
                            width, height = im.size
                            if is_rotated(im):
                                width, height = height, width
                            as_ratio=height/width
                            if (as_ratio<=1):
                                width=1
                                height=as_ratio
                            else:
                                width=1/as_ratio
                                height=1
                            im.close()
                        except Exception as e:
                            print(f"Error: {e}")

                        possible_extensions= ''.join(image_type + '|' for image_type in image_types)
                        possible_extensions = possible_extensions[:-1]
                        name=re.search(r'.*\\(.*).(' + possible_extensions + ')',file_name, re.IGNORECASE)[1]
                        file_name_server=file_name.replace('\\','/')
                        file_name_server=df["Folder"][i] + '/' + re.search(r'.*/(.*)', file_name_server)[1]

                        building[gallery_name][name]= {"resource": file_name_server, "resource_type": 'image',"width": f'{width:.2f}',
                                                        "height": f'{height:.2f}', "location": f'{[distribution[k][0],distribution[k][1],distribution[k][2]]}',
                                                        "vector": f'{[vectors[k,0], vectors[k,1]]}', 
                                                        "metadata": f'ID #{unique_id} ' + re.search(r"/([^/.]+)\.", file_name_server).group(1)}
                        unique_id= unique_id+1
                        k=k+1
                    items_left= items_left-max_items
                    j=j+max_items
                    m=m+1

                else:
                    #default case

                    gallery_distribution=GalleryManager(num_items)
                    [distribution, vectors, template]=gallery_distribution.solve_gallery(num_items)
                    gallery_name=df["Gallery name"][i]
                    building[gallery_name]={}
                    building[gallery_name]["parent"]=last_parent
                    building[gallery_name]["resource"]=gallery_name + '.glb'
                    building[gallery_name]["template"]=template
                    items_left=0
                    k=0
                    for file_name in files_grabbed:
                        try: 
                            im=Image.open(file_name)
                            width, height = im.size
                            if is_rotated(im):
                                width, height = height, width
                            as_ratio=height/width
                            if (as_ratio<=1):
                                width=1
                                height=as_ratio
                            else:
                                width=1/as_ratio
                                height=1
                            im.close()
                        except Exception as e:
                            print(f"Error: {e}")

                        possible_extensions= ''.join(image_type + '|' for image_type in image_types)
                        possible_extensions = possible_extensions[:-1]
                        name=re.search(r'.*\\(.*).(' + possible_extensions + ')',file_name, re.IGNORECASE)[1]
                        file_name_server=file_name.replace('\\','/')
                        file_name_server=df["Folder"][i] + '/' + re.search(r'.*/(.*)', file_name_server)[1]

                        building[df["Gallery name"][i]][name]= {"resource": file_name_server, "resource_type": 'image',"width": f'{width:.2f}', 
                                                                "height": f'{height:.2f}',"location": f'[{distribution[k][0]:.3f},{distribution[k][1]:.3f},{distribution[k][2]:.3f}]',
                                                                "vector": f'[{vectors[k,0]:.1f},{vectors[k,1]:.1f}]',
                                                                "metadata": f'ID #{unique_id} ' + re.search(r"/([^/.]+)\.", file_name_server).group(1) }
                        unique_id=unique_id+1
                        k=k+1

            

    #go through all parented galleries to add doors
    for gallery in building.keys():
        parent=building[gallery]["parent"]
        if parent!="none":
            #door in the parent
            building[parent][gallery]={}
            building[parent][gallery]["resource"]= gallery + '.glb'
            building[parent][gallery]["resource_type"]="door"

            #door in the gallery
            building[gallery][parent]={}
            building[gallery][parent]["resource"]= parent + '.glb'
            building[gallery][parent]["resource_type"]="door"

       
    #add technical elements
    building["Technical"]={}
    building["Technical"]["ambientLight"]=0.5
    building["Technical"]["pointLight"]=50
    building["Technical"]["scaleFactor"]=gallery_distribution.geometry["item_max_size"]


    with open(openvgal_folder + '/web_server/content/' + output_file, "w") as fp:
        json.dump(building,fp, indent=2)
        
    sys.exit(0)
        
        
        
# Run main() only if the script is executed directly
if __name__ == "__main__":
    # Set up argument parser
    parser = argparse.ArgumentParser(description="OpenVGal. Parsing of the csv file to create a .json file.")
    parser.add_argument("--openvgal_folder", type=str, help="Path of the openvgal root folder (where python/ and web_content/ are located)")


    # Parse arguments
    args = parser.parse_args()

    # Call main function with parsed arguments
    main(openvgal_folder=args.openvgal_folder)