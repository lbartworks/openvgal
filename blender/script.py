import bpy
import mathutils
import json
import math
import bmesh

#### SEE CONFIGURATIO BLOCK AFTER THE TWO FUNCTION DEFINITIONS


def calculate_rotation(v):
    v1_norm = mathutils.Vector((0,0,1))
    v2_norm = v.normalized()

    # Check if the vectors are parallel and pointing in opposite directions
    if v1_norm.dot(v2_norm) == -1:
        # Choose the y-axis as the rotation axis
        rotation_axis = mathutils.Vector((0, 1, 0))
        rotation_angle = math.pi
    else:
        # Calculate rotation axis and angle
        rotation_axis = v1_norm.cross(v2_norm)
        rotation_angle = math.acos(min(max(v1_norm.dot(v2_norm), -1.0), 1.0))

    # Create a rotation matrix from axis and angle
    rotation_matrix = mathutils.Matrix.Rotation(rotation_angle, 4, rotation_axis)

    # Decompose the rotation matrix into Euler angles
    rotation_euler = rotation_matrix.to_euler()

    return rotation_euler



def item_builder(name, item_position, item_size, vector, material=None):
    rotation = calculate_rotation(vector)
    bpy.ops.mesh.primitive_plane_add(size=1, align='WORLD', location=(0, 0, 0), rotation=rotation)
    item = bpy.context.active_object
    item.name = name
    
    # Set plane dimensions
    item.dimensions = (item_size['width'], item_size['height'], 0)

    # Set plane position
    item.location = mathutils.Vector((item_position['x'], item_position['y'], item_position['z']))

    if material:
        item.data.materials.append(material)
        
        # Enter Edit mode
    bpy.ops.object.mode_set(mode='EDIT')

    # Get bmesh from the plane mesh
    bm = bmesh.from_edit_mesh(item.data)

    # Create a UV layer if it doesn't exist
    if not bm.loops.layers.uv:
        bm.loops.layers.uv.new("UVMap")

    uv_layer = bm.loops.layers.uv.active

    # Flip the UV coordinates vertically
    for face in bm.faces:
        for loop in face.loops:
            loop[uv_layer].uv.y = 1 - loop[uv_layer].uv.y

    # Update the mesh with the new UV coordinates
    bmesh.update_edit_mesh(item.data)

    # Exit Edit mode
    bpy.ops.object.mode_set(mode='OBJECT')


    return item


### CONFIGURATION BLOCK


file_path = "C:/Users/LB_ARTWORKS/Documents/GitHub/test/building.json"
room_name='Antartida'
materials_folder="C:/Users/lb_ARTWORKS/Documents/GitHub/test/vgal/materials"


# Customizable parameters of the construction
door_height = 3  # Dimensions of the door to the parent gallery
door_width = 2
item_separation = 0.1  # This prevents that items and walls are co-planar
item_size = 2  # Parameter controlling the scale of the items


### END OF CONFIGURATION BLOCK

with open(file_path, 'r') as file:
    config_file = json.load(file)




# Create vectors
vector_n = mathutils.Vector((0, 0, -1))
vector_s = mathutils.Vector((0, 0, 1))
vector_e = mathutils.Vector((1, 0, 0))
vector_w = mathutils.Vector((-1, 0, 0))

# Geometry from configuration file
W = config_file[room_name]["geometry"][0]
L = config_file[room_name]["geometry"][1]
H = config_file[room_name]["geometry"][2]

# Vertical position
item_vposition = 1 + item_size / 2

# Geometry-related parameters
NN = config_file[room_name]["geometry"][3]
NS = config_file[room_name]["geometry"][4]
NW = config_file[room_name]["geometry"][5]
NE = config_file[room_name]["geometry"][6]

with_door = True
items_material = [None] * (NN + NS + NW + NE)
item_names = [None] * (NN + NS + NW + NE)
item_width = [None] * (NN + NS + NW + NE)
item_height = [None] * (NN + NS + NW + NE)

# Get the keys from the room in the config_file
dict_items = list(config_file[room_name].keys())


# Floor material
wood = bpy.data.materials.get("wood")
if not wood:
    wood = bpy.data.materials.new(name="wood")
    wood.use_nodes = True
    wood_bsdf = wood.node_tree.nodes["Principled BSDF"]
    wood_tex_image = bpy.data.images.load(materials_folder + "/wood_floor/WoodFloor051_2K_Color.jpg")
    wood_tex_node = wood.node_tree.nodes.new("ShaderNodeTexImage")
    wood_tex_node.image = wood_tex_image
    wood.node_tree.links.new(wood_tex_node.outputs[0], wood_bsdf.inputs["Base Color"])
    wood_tex_node.texture_mapping.scale[0] = 5
    wood_tex_node.texture_mapping.scale[1] = 5

# Wall material
concrete = bpy.data.materials.get("Plaster")
if not concrete:
    concrete = bpy.data.materials.get("wall")
    if not concrete:
        concrete = bpy.data.materials.new(name="wall")
        concrete.use_nodes = True
        concrete_bsdf = concrete.node_tree.nodes["Principled BSDF"]
        concrete_tex_image = bpy.data.images.load(materials_folder + "/concrete/gravel_concrete_diff_1k.jpg")
        concrete_tex_node = concrete.node_tree.nodes.new("ShaderNodeTexImage")
        concrete_tex_node.image = concrete_tex_image
        concrete.node_tree.links.new(concrete_tex_node.outputs[0], concrete_bsdf.inputs["Base Color"])


#concrete_tex_node.texture_mapping.scale[0] = 15
#concrete_tex_node.texture_mapping.scale[1] = 5






# The root gallery has some differences with any other gallery
for k in range(2, len(dict_items)):
    if room_name == 'root':
        item_vposition = door_height / 2
        item_names[k - 2] = "d_" + dict_items[k] + "_"
        with_door = False
    else:
        item_names[k - 2] = dict_items[k] + "_"

    item_width[k - 2] = float(config_file[room_name][dict_items[k]]["width"])
    item_height[k - 2] = float(config_file[room_name][dict_items[k]]["height"])


#
# Create room cube
bpy.ops.mesh.primitive_cube_add(size=1, enter_editmode=False, align='WORLD', location=(0, 0, 0))
room_cube = bpy.context.active_object
room_cube.name = "room_cube"

# Set the dimensions of the cube
room_cube.dimensions = (W, L, H)

# Rotate the cube 90 degrees around the X-axis to align with the Y-up convention
room_cube.rotation_euler = (math.radians(90), 0, 0)

# Move the cube up by half of its height
room_cube.location.y = H / 2

# Go to edit mode, select the bottom face, and delete it
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.mode_set(mode='OBJECT')

bottom_face_normal = mathutils.Vector((0, 0, -1))
for p in room_cube.data.polygons:
    if p.normal == bottom_face_normal:
        p.select = True

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.delete(type='FACE')
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Go to edit mode and select all faces
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')

# Flip the normals of the selected faces
bpy.ops.mesh.flip_normals()

# Return to object mode
bpy.ops.object.mode_set(mode='OBJECT')




# Assign materials to the remaining faces
for i, face in enumerate(room_cube.data.polygons):
    if face.normal == mathutils.Vector((0, 0, -1)):
        face.material_index = 0  # Assign the floor material
    else:
        face.material_index = 1  # Assign the wall material

room_cube.data.materials.append(wood)
room_cube.data.materials.append(concrete)








# Place user items
j = 0

# North
if with_door:
    if NN % 2 == 0:
        NR = NN // 2
        NL = NN // 2
    else:
        NR = NN // 2
        NL = NN // 2 + 1

    for i in range(1, NL + 1):
        # Place left
        delta = (W / 2 - door_width / 2) / (NL + 1)
        item = item_builder(item_names[j] + str(j), {"x": -W / 2 + delta * i, "y": item_vposition, "z": L / 2 - item_separation}, {"width": item_size * item_width[j], "height": item_size * item_height[j]}, vector_n, items_material[j])
        j += 1

    for i in range(1, NR + 1):
        # Place right
        delta = (W / 2 - door_width / 2) / (NR + 1)
        item = item_builder(item_names[j] + str(j), {"x": W / 2 - delta * i, "y": item_vposition, "z": L / 2 - item_separation}, {"width": item_size * item_width[j], "height": item_size * item_height[j]}, vector_n, items_material[j])
        j += 1

else:
    for i in range(1, NN + 1):
        # Place north
        delta = W / (NN + 1)
        item = item_builder(item_names[j] + str(j), {"x": -W / 2 + delta * i, "y": item_vposition, "z": L / 2 - item_separation}, {"width": item_size * item_width[j], "height": item_size * item_height[j]}, vector_n, items_material[j])
        j += 1


# South
for i in range(1, NS + 1):
    # Place south
    delta = W / (NS + 1)
    item = item_builder(item_names[j] + str(j), {"x": -W / 2 + delta * i, "y": item_vposition, "z": -L / 2 + item_separation}, {"width": item_size * item_width[j], "height": item_size * item_height[j]}, vector_s, items_material[j])
    j += 1

# East
for i in range(1, NE + 1):
    # Place east
    delta = L / (NE + 1)
    item = item_builder(item_names[j] + str(j), {"x": -W / 2 + item_separation, "y": item_vposition, "z": -L / 2 + delta * i}, {"width": item_size * item_width[j], "height": item_size * item_height[j]}, vector_e, items_material[j])
    j += 1

# West
for i in range(1, NW + 1):
    # Place west
    delta = L / (NW + 1)
    item = item_builder(item_names[j] + str(j), {"x": W / 2 - item_separation, "y": item_vposition, "z": -L / 2 + delta * i}, {"width": item_size * item_width[j], "height": item_size * item_height[j]}, vector_w, items_material[j])
    j += 1



# Room dimensions
room_width = W
room_height = H
room_length = L

# Light height
light_height = room_height * 0.9

# Calculate the positions for the lights
light_positions = [
    (0, light_height, -room_length / 4),
    (0, light_height, 0),
    (0, light_height, room_length / 4),
]

# Create point light sources at the calculated positions
for i, position in enumerate(light_positions):
    light_data = bpy.data.lights.new(name=f"Point Light {i + 1}", type='POINT')
    light_data.energy = 2000
    light_data.color = (1, 1, 1)
    
    light = bpy.data.objects.new(name=f"Point Light {i + 1}", object_data=light_data)
    light.location = position
    bpy.context.collection.objects.link(light)
