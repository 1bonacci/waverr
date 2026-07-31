import type { JSX } from 'react'
import { Chassis } from './components/Chassis'
import { Screen } from './components/Screen'
import { Wheel } from './components/Wheel'
import { useKeyboardControls } from './screen/useKeyboard'
import { useScreen } from './screen/useScreen'

export function App(): JSX.Element {
  const controller = useScreen()
  useKeyboardControls(controller)

  return (
    <Chassis>
      <Screen controller={controller} />
      <Wheel controller={controller} />
    </Chassis>
  )
}
