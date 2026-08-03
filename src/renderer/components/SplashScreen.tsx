import { useEffect, useRef, useState, type JSX } from 'react'
import logo from '../assets/logo.png'
import bootSound from '../assets/boot.mp3'
import styles from './SplashScreen.module.css'

interface SplashScreenProps {
  /** Called once the boot sequence has finished and the overlay should unmount. */
  onDone: () => void
}

/**
 * Dead air on the blank overlay before the logo starts to appear. Starting the
 * animation on the same frame the window becomes visible reads as a jump cut;
 * this beat lets the eye land on the screen first.
 */
const LEAD_IN_MS = 400
/** The twirl-in itself. */
const TWIRL_MS = 1500
/**
 * How far into the twirl the logo is fully opaque (the 12% keyframe). The boot
 * sound is cued from here rather than from the start of the animation: the
 * first frames are a transparent, blurred shape, and a sound landing on those
 * reads as coming from nowhere.
 */
const LOGO_VISIBLE_AT = LEAD_IN_MS + TWIRL_MS * 0.12
/**
 * The glow pulse, which rides on top of the settled logo.
 *
 * This is bounded by the total run rather than chosen freely: the hold below
 * is derived from it, so every millisecond here costs one on the whole splash.
 * The pulse reads slow mostly because its peak is centred with a shoulder
 * either side, not because of raw duration -- reshaping it is the cheaper
 * lever, and stretching it much past this pushes the splash over budget.
 */
const PULSE_MS = 1400
/** How far before the twirl ends the pulse starts, so the two blend. */
const PULSE_LEAD_MS = 200
/** A beat of stillness between the glow finishing and the logo leaving. */
const SETTLE_MS = 150
/**
 * How long the logo holds on screen after it settles, before it leaves.
 *
 * Derived rather than chosen: the pulse is the last thing happening on screen
 * and starts slightly before the twirl ends, so the hold is however long the
 * glow still has to run, plus a beat. Picking this by hand meant a slower glow
 * silently got its decay clipped by the exit.
 */
const HOLD_MS = PULSE_MS - PULSE_LEAD_MS + SETTLE_MS
/** The logo dissolving, which starts before the overlay does. */
const LOGO_OUT_MS = 420
/** The overlay fade, overlapping the tail of the logo's own exit. */
const FADE_MS = 520
/**
 * How far into the logo's exit the overlay starts fading. The two overlap so
 * the backdrop is already on its way out while the logo dissolves, instead of
 * the screen sitting empty and then blinking away.
 */
const FADE_OVERLAP_MS = 220

/** When the logo starts leaving, measured from the window becoming visible. */
const LOGO_OUT_AT = LEAD_IN_MS + TWIRL_MS + HOLD_MS
/** When the overlay starts fading. */
const FADE_AT = LOGO_OUT_AT + FADE_OVERLAP_MS
/** Total run: the overlay is fully transparent here and can unmount. */
const TOTAL_MS = FADE_AT + FADE_MS

/**
 * Boot splash: a beat of dark, then the logo resolves out of a blurred twirl,
 * pulses once with the boot sound, and dissolves as the screen fades through
 * to the real content. Runs once per launch, mounted over the glass.
 *
 * The window is created hidden and only shown once the renderer has already
 * painted (see `ready-to-show` in the main process), so this component is
 * mounted and running well before anyone can see or hear it. Both the sound
 * and the on-screen clock wait for the `windowShown` signal from main instead
 * of starting at mount -- otherwise the boot sound plays into a still-hidden
 * window and the visible animation ends up shorter than its own constants.
 */
export function SplashScreen({ onDone }: SplashScreenProps): JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => window.waverr.window.onShown(() => setShown(true)), [])

  useEffect(() => {
    if (!shown) return

    // The sound is the logo's sound, so it is cued to the logo actually being
    // on screen -- not to the lead-in, and not to the transparent first frames
    // of the twirl. Autoplay can be blocked before any user gesture; the splash
    // still runs on its own timer either way, so a rejected play() is not fatal.
    const sound = setTimeout(() => {
      void audioRef.current?.play().catch(() => {})
    }, LOGO_VISIBLE_AT)

    // Driven from state rather than a CSS delay so the exit is one keyframe
    // from wherever the logo actually is, and does not need to restate the
    // settled transform as its own starting frame.
    const exit = setTimeout(() => setLeaving(true), LOGO_OUT_AT)
    const done = setTimeout(onDone, TOTAL_MS)

    return () => {
      clearTimeout(sound)
      clearTimeout(exit)
      clearTimeout(done)
    }
  }, [shown, onDone])

  return (
    <div
      className={styles.overlay}
      style={shown ? { animationDelay: `${FADE_AT}ms` } : { animationPlayState: 'paused' }}
    >
      <div className={styles.stage}>
        {/* Behind the logo and its own element: the glow animates opacity and
            scale while the logo animates filter, so the two no longer overwrite
            each other's `filter` during the window where they overlap. */}
        <div
          className={styles.glow}
          style={
            leaving
              ? // Whatever the glow is doing, the exit is the logo's; the light
                // goes out with it rather than lingering over an empty stage.
                { animation: 'none', opacity: 0, transition: `opacity ${LOGO_OUT_MS}ms ease-out` }
              : shown
                ? {
                    animationDelay: `${LEAD_IN_MS + TWIRL_MS - PULSE_LEAD_MS}ms`,
                    animationDuration: `${PULSE_MS}ms`
                  }
                : { animationPlayState: 'paused' }
          }
        />
        {/* Carries the swell so it composes with the twirl's transform rather
            than replacing it. Shares the glow's timing: same delay, same
            duration, so the logo is biggest exactly when the light is. */}
        <div
          className={styles.breathe}
          style={
            leaving
              ? // The swell has long finished by the exit; dropping it here
                // keeps its held final frame from compounding with logoOut.
                { animation: 'none' }
              : shown
                ? {
                    animationDelay: `${LEAD_IN_MS + TWIRL_MS - PULSE_LEAD_MS}ms`,
                    animationDuration: `${PULSE_MS}ms`
                  }
                : { animationPlayState: 'paused' }
          }
        >
          <img
            src={logo}
            alt=""
            className={styles.logo}
            draggable={false}
            style={
              leaving
                ? // The exit replaces the entrance animation outright;
                  // `forwards` holds the dissolved frame until the overlay
                  // finishes fading.
                  { animation: `logoOut ${LOGO_OUT_MS}ms cubic-bezier(0.4, 0, 0.9, 0.4) forwards` }
                : shown
                  ? // The twirl waits out the lead-in.
                    { animationDelay: `${LEAD_IN_MS}ms`, animationDuration: `${TWIRL_MS}ms` }
                  : { animationPlayState: 'paused' }
            }
          />
        </div>
      </div>
      <audio ref={audioRef} src={bootSound} />
    </div>
  )
}
