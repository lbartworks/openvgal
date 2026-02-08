	// user custom variables that you need to modify
	const openvgal_location=window.openvgal_location; //empty string if at the root folder

	// Environment auto-detection
	const is_preview = window.openvgal_preview_mode || false;
	const is_hosted = window.location.hostname.includes('openvgal.com');
	const cdn_base = (is_hosted || is_preview) ? (window.openvgal_cdn_base || 'https://cdn.openvgal.com') : '';

	// CDN paths for templates/materials/icons when hosted or in preview; local paths otherwise
	const glb_location = cdn_base ? cdn_base + '/templates/' : openvgal_location + '/templates/';
	const materials_folder = cdn_base ? cdn_base + '/materials' : openvgal_location + '/materials';
	const icons_folder = cdn_base ? cdn_base + '/icons' : openvgal_location + '/icons';

	if (cdn_base) {
		console.log('CDN paths enabled:');
		console.log('  Templates:', glb_location);
		console.log('  Materials:', materials_folder);
		console.log('  Icons:', icons_folder);
	}

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
