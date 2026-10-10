import { useEffect, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Input, Text, View } from '@tarojs/components'
import Btn from '@/components/Btn'
import { callGame, GameApiError, toast, toastError } from '@/services/cloud'
import { clearSession, loadNickname, loadSession, saveNickname, saveSession, type Session } from '@/store/session'
import { MAX_NICKNAME } from '@/types/protocol'
import './index.scss'

type Busy = 'create' | 'join' | 'resume' | null

export default function Index() {
  const router = useRouter()
  const sharedCode = (router.params.code ?? '').replace(/\D/g, '').slice(0, 6)

  const [nickname, setNickname] = useState(loadNickname())
  const [code, setCode] = useState(sharedCode)
  const [busy, setBusy] = useState<Busy>(null)
  const [session, setSession] = useState<Session | null>(loadSession())

  useEffect(() => {
    if (sharedCode) setCode(sharedCode)
  }, [sharedCode])

  const validNick = () => {
    const n = nickname.trim()
    if (!n) {
      toast('先取個暱稱吧')
      return null
    }
    if (n.length > MAX_NICKNAME) {
      toast(`暱稱最多 ${MAX_NICKNAME} 個字`)
      return null
    }
    saveNickname(n)
    return n
  }

  const goRoom = (s: Session, status: 'lobby' | 'playing' | 'ended') => {
    saveSession(s)
    const page = status === 'playing' ? 'game' : 'lobby'
    void Taro.navigateTo({ url: `/pages/${page}/index?roomId=${s.roomId}` })
  }

  const create = async () => {
    const n = validNick()
    if (!n) return
    setBusy('create')
    try {
      const r = await callGame('createRoom', { nickname: n })
      goRoom({ roomId: r.roomId, code: r.code, pid: r.pid }, 'lobby')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  const join = async () => {
    const n = validNick()
    if (!n) return
    if (!/^\d{6}$/.test(code)) {
      toast('請輸入 6 位數房間碼')
      return
    }
    setBusy('join')
    try {
      const r = await callGame('joinRoom', { code, nickname: n })
      goRoom({ roomId: r.roomId, code: r.code, pid: r.pid }, r.status)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  const resume = async () => {
    if (!session) return
    setBusy('resume')
    try {
      const s = await callGame('syncState', { roomId: session.roomId })
      if (s.room.status === 'ended') {
        clearSession()
        setSession(null)
        toast('那一局已經結束了')
        return
      }
      goRoom(session, s.room.status)
    } catch (e) {
      if (e instanceof GameApiError && (e.code === 'NOT_MEMBER' || e.code === 'ROOM_NOT_FOUND')) {
        clearSession()
        setSession(null)
        toast('那個房間已經不在了')
      } else {
        toastError(e)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <View className="screen">
      <View className="home__hero">
        <Text className="h1">猜猜看</Text>
        <Text className="home__tagline">一個人出題，所有人匿名回答，然後猜猜每個人到底怎麼投的。</Text>
        <Text className="home__stamp">3 到 12 人，一人一支手機</Text>
      </View>

      {session && (
        <View className="card card--flat resume">
          <View>
            <Text className="field-label">上一局還在進行中</Text>
            <Text className="resume__code">{session.code}</Text>
          </View>
          <Btn inline variant="ghost" onClick={resume} loading={busy === 'resume'} disabled={busy !== null}>
            回到房間
          </Btn>
        </View>
      )}

      <View className="card">
        <Text className="field-label">你的暱稱</Text>
        <Input
          className="input"
          placeholderClass="placeholder"
          type="nickname"
          placeholder="大家會看到這個名字"
          maxlength={MAX_NICKNAME}
          value={nickname}
          onInput={(e) => setNickname(e.detail.value)}
        />
        <View className="gap" />
        <Btn onClick={create} loading={busy === 'create'} disabled={busy !== null}>
          開一個新房間
        </Btn>
        <View className="home__divider">
          <Text>或是加入朋友的房間</Text>
        </View>
        <Text className="field-label">房間碼</Text>
        <Input
          className="input input--code"
          placeholderClass="placeholder"
          type="number"
          placeholder="000000"
          maxlength={6}
          value={code}
          onInput={(e) => setCode(e.detail.value.replace(/\D/g, '').slice(0, 6))}
        />
        <View className="gap" />
        <Btn variant="ghost" onClick={join} loading={busy === 'join'} disabled={busy !== null}>
          加入房間
        </Btn>
      </View>
    </View>
  )
}
