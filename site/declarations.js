	// user custom variables that you need to modify
	const openvgal_location=window.openvgal_location; //empty string if at the root folder

	// CDN for templates and materials
	// Override: set window.openvgal_cdn_base = '' before loading this script to use local files instead
	const is_preview = window.openvgal_preview_mode || false;
	const cdn_base = (window.openvgal_cdn_base !== undefined) ? window.openvgal_cdn_base : 'https://cdn.openvgal.com';

	// CDN paths for templates/materials; falls back to local paths if cdn_base is empty
	const glb_location = cdn_base ? cdn_base + '/templates/' : openvgal_location + '/templates/';
	const materials_folder = cdn_base ? cdn_base + '/materials' : openvgal_location + '/materials';

	console.log(cdn_base ? 'CDN: ' + cdn_base : 'CDN disabled, using local paths');

	// Config file and images always relative to openvgal_location (or blob URLs in preview)
	const config_file_name=openvgal_location + '/building_v2.json';
	const hallspics_prefix= openvgal_location + ''; //empty string if pics at the root folder
	window.resolveImageUrl = function(path) { return hallspics_prefix + path; };


	//program constants
	const regul_exp_door=/^d_/;
	const regul_exp_tail= /_[0-9]*$/;
	//const regul_exp_artworks=/^(?!d_).*_\d{1,3}$/;
	const regul_exp_artworks=/_\d{1,3}$/;
	const frame_material="BJS_white"
