/// <reference types="@tarojs/taro" />

declare module '*.png'
declare module '*.gif'
declare module '*.jpg'
declare module '*.jpeg'
declare module '*.svg'
declare module '*.css'
declare module '*.scss'

declare namespace NodeJS {
  interface ProcessEnv {
    /** 編譯平台：本專案只針對 weapp */
    TARO_ENV: 'weapp' | 'h5' | 'swan' | 'alipay' | 'tt' | 'qq' | 'jd'
    NODE_ENV: 'development' | 'production'
  }
}
