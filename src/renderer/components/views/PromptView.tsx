import type { JSX } from 'react'
import type { View } from '../../screen/viewStack'
import styles from './PromptView.module.css'

interface PromptViewProps {
  view: Extract<View, { kind: 'prompt' }>
  error: string | null
}

/** Typing text on the LCD. It reuses the real keyboard, which is already how
 *  search works: no on-screen keyboard needed. */
export function PromptView({ view, error }: PromptViewProps): JSX.Element {
  return (
    <div className={styles.view} data-testid="prompt">
      <span className={styles.label}>{view.label}</span>
      <span className={styles.value} data-testid="prompt-value">
        {view.value}
        <span className={styles.caret}>_</span>
      </span>
      {error && <span className={styles.error}>{error}</span>}
      <span className={styles.hint}>ENTER = CONFIRM · MENU = CANCEL</span>
    </div>
  )
}
