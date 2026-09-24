/* --------------------------------------------------------------------------
   REACTIVE SIGNALS PATTERN
   Provides lightweight, fine-grained micro-signals for state updates.
   -------------------------------------------------------------------------- */

export function createSignal(initialValue) {
  let value = initialValue;
  const subscribers = new Set();

  function read() {
    return value;
  }

  function write(newValue) {
    if (value !== newValue) {
      value = typeof newValue === 'function' ? newValue(value) : newValue;
      subscribers.forEach(fn => fn(value));
    }
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return [read, write, subscribe];
}
