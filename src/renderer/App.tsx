import { useEffect } from 'react'
import type { JSX } from 'react'
import { Chassis } from './components/Chassis'
import { Screen } from './components/Screen'
import { Wheel } from './components/Wheel'
import { audioEngine } from './audio/AudioEngine'
import { useKeyboardControls } from './screen/useKeyboard'
import { useScreen } from './screen/useScreen'

export function App(): JSX.Element {
  const controller = useScreen()
  useKeyboardControls(controller)

  useEffect(() => {
    void audioEngine.restore()
  }, [])

  return (
    <Chassis>
      <Screen controller={controller} />
      <Wheel controller={controller} />
    </Chassis>
  )
}
