import type { JSX } from 'react'
import type { View } from '../../screen/viewStack'
import styles from './PromptView.module.css'

interface PromptViewProps {
  view: Extract<View, { kind: 'prompt' }>
  error: string | null
}

/** Escribir texto en la LCD. Reusa el teclado real, que ya es como se busca:
 *  no hace falta un teclado en pantalla. */
export function PromptView({ view, error }: PromptViewProps): JSX.Element {
  return (
    <div className={styles.view} data-testid="prompt">
      <span className={styles.label}>{view.label}</span>
      <span className={styles.value} data-testid="prompt-value">
        {view.value}
        <span className={styles.caret}>_</span>
      </span>
      {error && <span className={styles.error}>{error}</span>}
      <span className={styles.hint}>ENTER = CONFIRMAR · MENU = CANCELAR</span>
    </div>
  )
}
