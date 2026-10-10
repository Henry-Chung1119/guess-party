import type { PropsWithChildren } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { CLOUD_ENV } from './config'
import './app.scss'

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    if (process.env.TARO_ENV === 'weapp') {
      Taro.cloud.init({ env: CLOUD_ENV, traceUser: true })
    }
  })
  return children
}

export default App
