import Clutter from "gi://Clutter";

/**
 * ============================================================================
 * ICON_ANIMATION_CURVES — таблиця кривих для bounce-анімації іконок AppGrid
 * (наведення/відведення, натискання/відпускання).
 *
 * Порядок ключів навмисно збігається з порядком рядків у Gtk.StringList
 * у prefs.js (список кривих у випадаючому меню) — індекс вибору в
 * інтерфейсі відповідає позиції тут.
 *
 * На відміну від таблиці ANIMATIONS в animationManager.js (інше
 * розширення), тут лише один AnimationMode на криву (EASE_OUT_*), а не
 * пара show/hide (EASE_OUT_/EASE_IN_) — за задумом ease-out
 * використовується як у напрямку "наведено"/"натиснуто", так і у
 * зворотному ("відведено"/"відпущено"): у "виході" з ефекту не повинно
 * відчуватись різкого "розгону" (характерного для ease-in), тільки
 * плавне сповільнення в кінці руху, як і на вході. Додано "Linear",
 * якого не було в оригінальній таблиці.
 * ============================================================================
 */
export const ICON_ANIMATION_CURVES = {
    Back: Clutter.AnimationMode.EASE_OUT_BACK,
    Bounce: Clutter.AnimationMode.EASE_OUT_BOUNCE,
    Circ: Clutter.AnimationMode.EASE_OUT_CIRC,
    Cubic: Clutter.AnimationMode.EASE_OUT_CUBIC,
    Elastic: Clutter.AnimationMode.EASE_OUT_ELASTIC,
    Expo: Clutter.AnimationMode.EASE_OUT_EXPO,
    Linear: Clutter.AnimationMode.LINEAR,
    Quad: Clutter.AnimationMode.EASE_OUT_QUAD,
    Quart: Clutter.AnimationMode.EASE_OUT_QUART,
    Quint: Clutter.AnimationMode.EASE_OUT_QUINT,
    Sine: Clutter.AnimationMode.EASE_OUT_SINE,
};

// Крива, яку використовуємо, якщо в налаштуваннях опиниться щось,
// чого немає в таблиці вище (пошкоджений dconf, стара версія тощо).
const FALLBACK_CURVE = "Quad";

/**
 * ============================================================================
 * IconAnimator — застосування bounce-масштабування до одного actor'а
 * (у нашому випадку — item.icon.icon, St.Icon всередині BaseIcon).
 *
 * На відміну від TransitionEngine з animationManager.js (який скасовує
 * transition через actor.remove_transition(propName) за конкретною назвою
 * властивості), тут навмисно використано actor.remove_all_transitions():
 * властивість Clutter реєструє transition під канонічною GObject-назвою
 * ("scale-x", через дефіс), а не під JS-псевдонімом ("scale_x", через
 * підкреслення) — якщо колись передати підкреслений варіант у
 * remove_transition(), він мовчки не знайде transition і не скасує його.
 * Since тут анімується лише одна пара властивостей на actor (scale_x/
 * scale_y) і більше нічого, remove_all_transitions() дає той самий ефект
 * анти-flicker без цього ризику.
 * ============================================================================
 */
export class IconAnimator {
    /**
     * @param {Clutter.Actor} actor - actor для масштабування (item.icon.icon)
     * @param {Object} opts
     * @param {boolean} opts.active - true = наведено/натиснуто (їдемо до targetScale), false = повертаємось до 1.0
     * @param {number} opts.targetScale - масштаб у активному стані (напр. 1.10)
     * @param {string} opts.curveName - ключ з ICON_ANIMATION_CURVES
     * @param {number} opts.inDuration - тривалість (мс) переходу в активний стан
     * @param {number} opts.outDuration - тривалість (мс) переходу назад
     */
    static scale(
        actor,
        { active, targetScale, curveName, inDuration, outDuration },
    ) {
        if (!actor || actor.is_destroyed?.()) return;

        actor.remove_all_transitions();
        actor.set_pivot_point(0.5, 0.5);

        // ...

        const mode =
            ICON_ANIMATION_CURVES[curveName] ??
            ICON_ANIMATION_CURVES[FALLBACK_CURVE];
        const duration = active ? inDuration : outDuration;

        const animationScale = active ? targetScale : 1.0;

        const baseScale =
            Number.isFinite(actor._chIconSizeScale) &&
            actor._chIconSizeScale > 0
                ? actor._chIconSizeScale
                : 1.0;

        const scale = baseScale * animationScale;

        actor.ease({
            scale_x: scale,
            scale_y: scale,
            mode,
            duration,
        });

    }

    /** Миттєво (без анімації) повертає actor у стан спокою — для disable(). */
    static reset(actor) {
        if (!actor || actor.is_destroyed?.()) return;
        actor.remove_all_transitions();
        actor.set_scale(1.0, 1.0);
    }
}
