import { useEffect, useRef, type JSX, type RefObject } from 'react'
import type { ScreenController, ScreenItem } from '../../screen/useScreen'
import { useLongPress } from '../../screen/useLongPress'
import styles from './ListView.module.css'

interface ListViewProps {
  controller: ScreenController
}

/**
 * Lista generica de la pantalla. Sirve para menus, carpetas, resultados de
 * busqueda y ajustes: todos llegan aca como `ScreenItem[]`.
 */
export function ListView({ controller }: ListViewProps): JSX.Element {
  const { items, selected, loading, view } = controller
  const selectedRef = useRef<HTMLButtonElement>(null)

  // La fila agarrada en modo mover, si la hay: solo existe en COLA y PLAYLIST.
  const movingTo =
    (view.kind === 'queue' || view.kind === 'playlist') && view.moving ? view.moving.to : null

  // La fila seleccionada se mantiene visible cuando se navega con el teclado.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, items])

  if (items.length === 0) {
    return <div className={styles.empty}>{loading ? 'CARGANDO...' : 'VACIO'}</div>
  }

  return (
    <div className={styles.list} data-testid="screen-list">
      {items.map((item, index) => (
        <Row
          key={item.key}
          item={item}
          index={index}
          selected={index === selected}
          moving={index === movingTo}
          controller={controller}
          rowRef={index === selected ? selectedRef : undefined}
        />
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
  const press = useLongPress(
    () => {
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
      <span className={styles.label}>{item.label}</span>
      {item.meta && <span className={styles.meta}>{item.meta}</span>}
      {item.drillsDown && <span className={styles.chevron}>&gt;</span>}
    </button>
  )
}
