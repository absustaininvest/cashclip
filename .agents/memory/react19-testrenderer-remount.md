---
name: React 19 test-renderer remount trap
description: react-test-renderer@19 re-mounts the component tree inside act(), breaking in-process refresh triggers for deduplication tests.
---

## The Rule
Do NOT try to prove second-loadData deduplication by triggering `onRefresh` on a live `TestRenderer` instance when the component uses `useEffect`-based data loading. Instead, use two sequential `TestRenderer.create()` calls that share the same in-test storage.

**Why:** react-test-renderer@19 (concurrent mode) can unmount and remount the component tree inside an `act()` call — especially when `act` contains a `setTimeout`. On remount, a fresh `useEffect(cb, [])` fires again, and if the storage cursor write from the first mount's loadData hasn't landed yet, the second loadData races it and fires the modal a second time.

**How to apply:**
- When testing "second call does not re-fire": run `TestRenderer.create(WalletScreen)` + `flush()` twice in the same test, resetting the spy counter (`bonusFireCount=0`, `prevModalVisible=false`) between them. The shared in-test mock storage (Map) preserves the cursor written by the first loadData.
- When you MUST use `onRefresh`, `await rc.props.onRefresh()` directly inside `act()` (no `setTimeout` drain). Even then, React 19 may still remount.
- The spy for `RewardSuccessModal` should count **false→true transitions** (`bonusFireCount`) rather than current `visible` state. When the modal is already visible and the component re-renders during a refresh, inspecting `visible` gives a false positive. Track `prevModalVisible` and increment only on `visible && !prevModalVisible`.
- `FlatList` mock must render `refreshControl` as a **child element** (not a prop) so `tr.root.find(n => n.type === "RefreshControl")` can traverse to it.
