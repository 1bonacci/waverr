import { useEffect, useRef, type JSX } from 'react'
import type { ScreenController } from '../../screen/useScreen'
import styles from './ListView.module.css'

interface ListViewProps {
  controller: ScreenController
}

/**
 * Lista generica de la pantalla. Sirve para menus, carpetas, resultados de
 * busqueda y ajustes: todos llegan aca como `ScreenItem[]`.
 */
export function ListView({ controller }: ListViewProps): JSX.Element {
  const { items, selected, loading } = controller
  const selectedRef = useRef<HTMLButtonElement>(null)

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
        <button
          type="button"
          key={item.key}
          ref={index === selected ? selectedRef : undefined}
          data-testid="screen-row"
          data-selected={index === selected ? 'true' : 'false'}
          className={`${styles.row} ${index === selected ? styles.rowSelected : ''}`}
          onClick={() => {
            controller.dispatch({ type: 'setSelection', index })
            void item.activate()
          }}
        >
          {item.favorite && <span className={styles.star}>★</span>}
          <span className={styles.label}>{item.label}</span>
          {item.meta && <span className={styles.meta}>{item.meta}</span>}
          {item.drillsDown && <span className={styles.chevron}>&gt;</span>}
        </button>
      ))}
    </div>
  )
}
