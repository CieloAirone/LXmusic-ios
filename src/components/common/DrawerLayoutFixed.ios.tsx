import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Animated, Keyboard, PanResponder, Pressable, StyleSheet, View, type DrawerLayoutAndroidProps } from 'react-native'
import { usePageVisible } from '@/store/common/hook'
import type { COMPONENT_IDS } from '@/config/constant'
interface Props extends DrawerLayoutAndroidProps {
  visibleNavNames: COMPONENT_IDS[]
  widthPercentage: number
  widthPercentageMax?: number
}
export interface DrawerLayoutFixedType {
  openDrawer: () => void
  closeDrawer: () => void
  fixWidth: () => void
}
export default forwardRef<DrawerLayoutFixedType, Props>(({
  visibleNavNames, widthPercentage, widthPercentageMax, children, renderNavigationView,
  drawerPosition = 'left', drawerBackgroundColor, drawerLockMode, onDrawerOpen, onDrawerClose, style,
}, ref) => {
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)
  const open = useRef(false)
  const progress = useRef(new Animated.Value(0)).current
  const dragStart = useRef(0)
  const side = drawerPosition === 'right' ? -1 : 1
  const drawerWidth = Math.min(width * widthPercentage, widthPercentageMax ?? Infinity)
  const animate = useCallback((value: boolean) => {
    Keyboard.dismiss()
    open.current = value
    if (value) setVisible(true)
    Animated.timing(progress, { toValue: value ? 1 : 0, duration: 220, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return
      if (value) onDrawerOpen?.()
      else { setVisible(false); onDrawerClose?.() }
    })
  }, [onDrawerClose, onDrawerOpen, progress])
  useImperativeHandle(ref, () => ({ openDrawer: () => { animate(true) }, closeDrawer: () => { animate(false) }, fixWidth: () => {} }), [animate])
  usePageVisible(visibleNavNames, useCallback(pageVisible => { if (!pageVisible && open.current) animate(false) }, [animate]))
  const gestures = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => {
      if (drawerLockMode === 'locked-closed' || drawerLockMode === 'locked-open' || !drawerWidth) return false
      const x = event.nativeEvent.locationX - gesture.dx
      const edge = side === 1 ? x < 28 : x > width - 28
      return Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4 && (open.current || (edge && gesture.dx * side > 0))
    },
    onPanResponderGrant: () => {
      progress.stopAnimation()
      dragStart.current = open.current ? 1 : 0
      Keyboard.dismiss(); setVisible(true)
    },
    onPanResponderMove: (_event, gesture) => { progress.setValue(Math.max(0, Math.min(1, dragStart.current + gesture.dx * side / drawerWidth))) },
    onPanResponderRelease: (_event, gesture) => {
      const value = dragStart.current + gesture.dx * side / drawerWidth
      animate(Math.abs(gesture.vx) > 0.4 ? gesture.vx * side > 0 : value > 0.5)
    },
    onPanResponderTerminate: () => { animate(open.current) },
  }), [animate, drawerLockMode, drawerWidth, progress, side, width])
  return <View style={[{ flex: 1, overflow: 'hidden' }, style]} onLayout={event => { setWidth(event.nativeEvent.layout.width) }} {...gestures.panHandlers}>
    <View style={{ flex: 1 }} accessibilityElementsHidden={visible}>{children}</View>
    {visible ? <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { animate(false) }} accessibilityLabel="关闭侧栏" accessibilityRole="button" />
      </Animated.View>
      <Animated.View style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side === 1 ? 'left' : 'right']: 0,
        width: drawerWidth,
        backgroundColor: drawerBackgroundColor ?? 'white',
        transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-side * drawerWidth, 0] }) }],
      }}>
        <View style={{ flex: 1 }} collapsable={false}>{renderNavigationView()}</View>
      </Animated.View>
    </View> : null}
  </View>
})
