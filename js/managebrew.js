import {ManageBrewUi} from "./utils-brew/utils-brew-ui-manage.js";

import {initWorkshop} from "./homebrew/workshop-ui.js";

class ManageBrew {
	static async pInitialise () {
		return ManageBrew.pRender();
	}

	static async pRender () {
		const manager = new ManageBrewUi({brewUtil: BrewUtil2});
		return manager.pRender(es(`#manager`).empty());
	}
}

window.addEventListener("load", async () => {
	await Promise.all([
		PrereleaseUtil.pInit(),
		BrewUtil2.pInit(),
	]);
	ExcludeUtil.pInitialise().then(null); // don't await, as this is only used for search
	await ManageBrew.pInitialise();
	const sharingNote = document.createElement("p");
	sharingNote.className = "ve-mb-3";
	sharingNote.textContent = "Homebrew saved or imported here is shared with everyone using this site. Existing private entries stay local until you publish a copy in the Workshop or save an edit. Removing a browser copy does not delete the shared library.";
	document.querySelector("#manager").before(sharingNote);
	await initWorkshop({onSave: () => ManageBrew.pRender()});

	window.dispatchEvent(new Event("toolsLoaded"));
});
