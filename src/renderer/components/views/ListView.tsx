import { Fragment, useEffect, useRef, type JSX, type RefObject } from 'react'
import type { ScreenController, ScreenItem } from '../../screen/useScreen'
import { useLongPress } from '../../screen/useLongPress'
import styles from './ListView.module.css'

interface ListViewProps {
  controller: ScreenController
}

/**
 * The screen's generic list. Used for menus, tracks, search results and
 * settings alike: they all arrive here as `ScreenItem[]`.
 */
export function ListView({ controller }: ListViewProps): JSX.Element {
  const { items, selected, loading, view } = controller
  const selectedRef = useRef<HTMLButtonElement>(null)

  // The row held in move mode, if any: only exists in QUEUE and PLAYLIST.
  const movingTo =
    (view.kind === 'queue' || view.kind === 'playlist') && view.moving ? view.moving.to : null

  // Keeps the selected row visible while navigating with the keyboard.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, items])

  if (items.length === 0) {
    return <div className={styles.empty}>{loading ? 'LOADING...' : 'EMPTY'}</div>
  }

  return (
    <div className={styles.list} data-testid="screen-list">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {item.sectionHeader && (
            <div className={styles.sectionHeader}>{item.sectionHeader}</div>
          )}
          <div className={styles.rowWrap} data-testid="screen-row-wrap">
            <Row
              item={item}
              index={index}
              selected={index === selected}
              moving={index === movingTo}
              controller={controller}
              rowRef={index === selected ? selectedRef : undefined}
            />
            {item.canHide && item.trackId !== undefined && (
              <button
                type="button"
                className={styles.trash}
                title={`Hide ${item.label}`}
                aria-label={`Hide ${item.label}`}
                data-testid="row-trash"
                // Pointer events, not just click: the row listens on
                // pointerdown/up for its long press, and those fire first.
                // Without stopping them here, hiding a track would also select
                // and play it.
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  controller.hideTrack(item.trackId!, item.label)
                }}
              >
                {/* Drawn rather than typed: the LCD font is monospace and has
                    no glyph for the trash emoji, which rendered as a blank
                    box. `currentColor` keeps it in step with the row. */}
                <svg
                  viewBox="0 0 14 14"
                  width="11"
                  height="11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M2.5 3.5h9M5.5 3.5V2.2h3v1.3M3.6 3.5l.6 8.3h5.6l.6-8.3M6 6v3.6M8 6v3.6" />
                </svg>
              </button>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function Row({
  item,
  index,
  selected,
  moving,
  controller,
  rowRef
}: {
  item: ScreenItem
  index: number
  selected: boolean
  moving: boolean
  controller: ScreenController
  rowRef?: RefObject<HTMLButtonElement | null>
}): JSX.Element {
  // With a row held in move mode, clicking any row drops it there instead of
  // activating it: activating a manual queue row mid-move used to shift (and
  // mangle) the queue, because `item.activate()` knows nothing about a drag
  // being in progress.
  const { view } = controller
  const isMoving = (view.kind === 'queue' || view.kind === 'playlist') && view.moving !== null

  const press = useLongPress(
    () => {
      if (isMoving) {
        controller.dropAt(index)
        return
      }
      controller.dispatch({ type: 'setSelection', index })
      void item.activate()
    },
    () => controller.openContextMenu(index)
  )

  return (
    <button
      type="button"
      ref={rowRef}
      data-testid="screen-row"
      data-selected={selected ? 'true' : 'false'}
      data-moving={moving ? 'true' : 'false'}
      className={`${styles.row} ${selected ? styles.rowSelected : ''} ${moving ? styles.rowMoving : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        controller.openContextMenu(index)
      }}
      {...press}
    >
      {item.favorite && <span className={styles.star}>★</span>}
      {moving && (
        <span className={styles.moveMark} aria-hidden="true">
          ^
        </span>
      )}
      <span className={styles.label}>{item.label}</span>
      {moving && (
        <span className={styles.moveMark} aria-hidden="true">
          ^
        </span>
      )}
      {item.meta && <span className={styles.meta}>{item.meta}</span>}
      {item.drillsDown && <span className={styles.chevron}>&gt;</span>}
    </button>
  )
}
