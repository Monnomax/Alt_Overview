import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import Lifecycle from "./src/lifecycle.js";

export default class OverviewBackgroundExtension extends Extension {
    enable() {
        this._lifecycle = new Lifecycle(this);
        this._lifecycle.enable();
    }

    disable() {
        const lifecycle = this._lifecycle;
        this._lifecycle = null;
        lifecycle?.disable();
    }
}
