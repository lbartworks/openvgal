    // user custom variables that you need to modify
	const openvgal_location=window.openvgal_location; //empty strin if at the root folder
	const glb_location= openvgal_location + '/templates/';
	const config_file_name=openvgal_location + '/building_v2.json';
	const materials_folder=openvgal_location + '/materials';
	const hallspics_prefix= openvgal_location + ''; //empty string if pics at the root folder
	const icons_folder=openvgal_location + '/icons';
	
	
	//program constants
	const regul_exp_door=/^d_/;
	const regul_exp_tail= /_[0-9]*$/;
	//const regul_exp_artworks=/^(?!d_).*_\d{1,3}$/;
	const regul_exp_artworks=/_\d{1,3}$/;
	const frame_material="BJS_white"