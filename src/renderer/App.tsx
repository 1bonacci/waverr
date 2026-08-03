import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Chassis } from './components/Chassis'
import { Screen } from './components/Screen'
import { Wheel } from './components/Wheel'
import { audioEngine } from './audio/AudioEngine'
import { useKeyboardControls } from './screen/useKeyboard'
import { useScreen } from './screen/useScreen'
import { useUiStore } from './store/ui'

export function App(): JSX.Element {
  const controller = useScreen()
  useKeyboardControls(controller)
  const [showSplash, setShowSplash] = useState(true)
  const dismissSplash = useCallback(() => setShowSplash(false), [])

  useEffect(() => {
    void audioEngine.restore()
    void useUiStore.getState().restoreVisualizerMode()
  }, [])

  return (
    <Chassis>
      <Screen controller={controller} showSplash={showSplash} onSplashDone={dismissSplash} />
      <Wheel controller={controller} />
    </Chassis>
  )
}
