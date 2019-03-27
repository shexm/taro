import {
  internal_safe_get as safeGet,
  internal_safe_set as safeSet
} from '@tarojs/taro'
// import PropTypes from 'prop-types'
import { componentTrigger } from './create-component'
import { shakeFnFromObject, isEmptyObject, diffObjToPath } from './util'
import { Current } from './current-owner'
import { invokeEffects } from './hooks'

// const isDEV = typeof process === 'undefined' ||
//   !process.env ||
//   process.env.NODE_ENV !== 'production'

export function updateComponent (component) {
  const { props } = component
  // if (isDEV && __propTypes) {
  //   const componentName = component.constructor.name || component.constructor.toString().match(/^function\s*([^\s(]+)/)[1]
  //   PropTypes.checkPropTypes(__propTypes, props, 'prop', componentName)
  // }
  const prevProps = component.prevProps || props
  component.props = prevProps
  if (component.__mounted && component._unsafeCallUpdate === true && component.componentWillReceiveProps) {
    component._disable = true
    component.componentWillReceiveProps(props)
    component._disable = false
  }
  // 在willMount前执行构造函数的副本
  if (!component.__componentWillMountTriggered) {
    component._constructor && component._constructor(props)
  }
  let state = component.getState()

  const prevState = component.prevState || state

  let skip = false
  if (component.__mounted) {
    if (typeof component.shouldComponentUpdate === 'function' &&
      !component._isForceUpdate &&
      component.shouldComponentUpdate(props, state) === false) {
      skip = true
    } else if (typeof component.componentWillUpdate === 'function') {
      component.componentWillUpdate(props, state)
    }
  }
  component.props = props
  component.state = state
  component._dirty = false
  component._isForceUpdate = false
  if (!component.__componentWillMountTriggered) {
    component.__componentWillMountTriggered = true
    componentTrigger(component, 'componentWillMount')
  }
  if (!skip) {
    doUpdate(component, prevProps, prevState)
  }
  component.prevProps = component.props
  component.prevState = component.state
}

function doUpdate (component, prevProps, prevState) {
  const { state, props = {} } = component
  let data = state || {}
  if (component._createData) {
    // 返回null或undefined则保持不变
    const runLoopRef = !component.__mounted
    if (component.__isReady) {
      Current.current = component
      Current.index = 0
      invokeEffects(component, true)
    }
    data = component._createData(state, props, runLoopRef) || data
    if (component.__isReady) {
      Current.current = null
    }
  }

  data = Object.assign({}, props, data)
  if (component.$usedState && component.$usedState.length) {
    const _data = {}
    component.$usedState.forEach(key => {
      let val = safeGet(data, key)
      if (typeof val === 'undefined') {
        return
      }
      if (typeof val === 'object') {
        if (isEmptyObject(val)) return safeSet(_data, key, val)

        val = shakeFnFromObject(val)
        // 避免筛选完 Fn 后产生了空对象还去渲染
        if (!isEmptyObject(val)) safeSet(_data, key, val)
      } else {
        safeSet(_data, key, val)
      }
    })
    data = _data
  }
  data['$taroCompReady'] = true

  const dataDiff = diffObjToPath(data, component.$scope.data)
  const __mounted = component.__mounted

  // 每次 setData 都独立生成一个 callback 数组
  let cbs = []
  if (component._pendingCallbacks && component._pendingCallbacks.length) {
    cbs = component._pendingCallbacks
    component._pendingCallbacks = []
  }

  const cb = function () {
    if (__mounted) {
      invokeEffects(component)
      if (component['$$refs'] && component['$$refs'].length > 0) {
        component['$$refs'].forEach(ref => {
          // 只有 component 类型能做判断。因为 querySelector 每次调用都一定返回 nodeRefs，无法得知 dom 类型的挂载状态。
          if (ref.type !== 'component') return

          let target = component.$scope.selectComponent(`#${ref.id}`)
          target = target ? (target.$component || target) : null

          const prevRef = ref.target
          if (target !== prevRef) {
            if (ref.refName) component.refs[ref.refName] = target
            typeof ref.fn === 'function' && ref.fn.call(component, target)
            ref.target = target
          }
        })
      }

      if (component['$$hasLoopRef']) {
        component._disableEffect = true
        component._createData(component.state, component.props, true)
        component._disableEffect = false
      }

      if (typeof component.componentDidUpdate === 'function') {
        component.componentDidUpdate(prevProps, prevState)
      }
    }

    if (cbs.length) {
      let i = cbs.length
      while (--i >= 0) {
        typeof cbs[i] === 'function' && cbs[i].call(component)
      }
    }
  }
  if (Object.keys(dataDiff).length === 0) {
    cb()
  } else {
    component.$scope.setData(dataDiff, cb)
  }
}
