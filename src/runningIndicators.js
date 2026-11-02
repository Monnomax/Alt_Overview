import Clutter from "gi://Clutter";
import St from "gi://St";
import GObject from "gi://GObject";
import GdkPixbuf from "gi://GdkPixbuf";

function getAverageAppIconColor(app) {
    try {
        const gicon = app?.get_icon();
        if (!gicon) return null;

        const theme =
            typeof St.IconTheme.get_default === "function"
                ? St.IconTheme.get_default()
                : new St.IconTheme();
        const iconInfo = theme.lookup_by_gicon(
            gicon,
            48,
            St.IconLookupFlags.NONE,
        );
        const filename = iconInfo?.get_filename();
        if (!filename) return null;

        const pixels = GdkPixbuf.Pixbuf.new_from_file(filename)
            .scale_simple(1, 1, GdkPixbuf.InterpType.BILINEAR)
            .get_pixels();

        return `rgb(${pixels[0]}, ${pixels[1]}, ${pixels[2]})`;
    } catch {
        return null;
    }
}

const RunningDot = GObject.registerClass(
    class RunningDot extends St.Widget {
        _init(size) {
            super._init({
                style_class: "ch-app-grid-running-dot",
                reactive: false,
                can_focus: false,
            });
            this._dotSize = size;
        }

        vfunc_get_preferred_width(_forHeight) {
            return [this._dotSize, this._dotSize];
        }

        vfunc_get_preferred_height(_forWidth) {
            return [this._dotSize, this._dotSize];
        }
    },
);

export class RunningIndicators {
    static DOT_SIZE = 20;

    ensureOverlay(item, iconSize = null) {
        const icon = item?.icon?.icon;
        const iconBin = item?.icon?._iconBin;
        const nativeDot = item?._dot;

        if (!icon || !iconBin || !nativeDot) return;

        if (
            item._chRunningOverlay &&
            !item._chRunningOverlay.is_destroyed?.() &&
            item._chRunningOverlayIcon === icon
        ) {
            const size =
                Number.isFinite(iconSize) && iconSize > 0
                    ? iconSize
                    : Number(icon._chFixedPreferredSize) || Number(icon.width);
            this._updateOverlayGeometry(item, size);
            return;
        }

        if (
            item._chRunningOverlay &&
            !item._chRunningOverlay.is_destroyed?.()
        ) {
            item._chRunningOverlay.destroy();
        }

        item._chRunningOverlay = null;
        item._chRunningOverlayIcon = null;
        nativeDot.opacity = 0;

        const overlay = new Clutter.Actor({
            layout_manager: new Clutter.FixedLayout(),
        });
        overlay.clip_to_allocation = false;
        overlay.set_pivot_point(0.5, 0.5);
        overlay._chPreferredSize = 1;
        overlay.get_preferred_size = function () {
            const size = this._chPreferredSize;
            return [size, size, size, size];
        };

        if (icon.get_parent() === iconBin) iconBin.remove_child(icon);
        iconBin.child = overlay;
        overlay.add_child(icon);

        const dot = new RunningDot(RunningIndicators.DOT_SIZE);
        const dotColor = getAverageAppIconColor(item.app);
        if (dotColor) dot.set_style(`background-color: ${dotColor};`);
        dot.clip_to_allocation = false;
        overlay.add_child(dot);

        item._chRunningOverlay = overlay;
        item._chRunningOverlayIcon = icon;
        item._chRunningDot = dot;
        item._chRunningDotVisibleId = nativeDot.connect(
            "notify::visible",
            () => {
                if (
                    item._chRunningDot &&
                    !item._chRunningDot.is_destroyed?.()
                ) {
                    item._chRunningDot.visible = nativeDot.visible;
                }
            },
        );
        dot.visible = nativeDot.visible;

        const size =
            Number.isFinite(iconSize) && iconSize > 0
                ? iconSize
                : Number(icon._chFixedPreferredSize) || Number(icon.width);
        this._updateOverlayGeometry(item, size);
    }

    updateOverlayGeometry(item, iconSize) {
        this._updateOverlayGeometry(item, iconSize);
    }

    restore(item, icon, iconBin) {
        const nativeDot = item?._dot;
        const overlay = item?._chRunningOverlay;

        if (
            item?._chRunningDotVisibleId &&
            nativeDot &&
            !nativeDot.is_destroyed?.()
        ) {
            nativeDot.disconnect(item._chRunningDotVisibleId);
            item._chRunningDotVisibleId = 0;
        }

        if (
            icon &&
            iconBin &&
            overlay &&
            !overlay.is_destroyed?.() &&
            !icon.is_destroyed?.()
        ) {
            if (icon.get_parent() === overlay) overlay.remove_child(icon);
            iconBin.child = icon;
        }

        item._chRunningDot = null;
        if (overlay && !overlay.is_destroyed?.()) overlay.destroy();
        item._chRunningOverlay = null;
        item._chRunningOverlayIcon = null;

        if (nativeDot && !nativeDot.is_destroyed?.()) nativeDot.opacity = 255;
    }

    _updateOverlayGeometry(item, iconSize) {
        const overlay = item?._chRunningOverlay;
        const icon = item?._chRunningOverlayIcon;
        const dot = item?._chRunningDot;

        if (
            !overlay ||
            !icon ||
            !dot ||
            overlay.is_destroyed?.() ||
            icon.is_destroyed?.() ||
            dot.is_destroyed?.()
        ) {
            return;
        }

        const size = Number(iconSize);
        if (!Number.isFinite(size) || size <= 0) return;

        overlay.set_size(size, size);
        icon.set_position(0, 0);
        icon.set_size(size, size);

        const dotSize = RunningIndicators.DOT_SIZE;
        dot.set_size(dotSize, dotSize);
        dot.set_position(Math.round(size - dotSize), 0);

        overlay.clip_to_allocation = false;
        icon.clip_to_allocation = false;
        dot.clip_to_allocation = false;
    }
}
