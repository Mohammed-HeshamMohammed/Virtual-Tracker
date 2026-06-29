/** @internal Import from `../../shared/hooks/<file>` within `people/` only. */

export { usePaginatedTable } from "@/shared/tables/hooks/use-paginated-table"
export { useCachedList } from "@/shared/tables/hooks/use-cached-list"
export { useMemberTreeData } from "@/features/members/hooks/use-member-tree-data"
export { useCachedMultiList } from "@/shared/tables/hooks/use-cached-multi-list"
export { useMembersListData } from "@/features/members/hooks/use-members-list-data"
export {
  useAutoHiddenTableColumns,
  computeAutoHiddenTableColumns,
  getMembersTableFixedWidth,
  getMembersTableMinWidth,
  MEMBER_COL_AUTO_HIDE_PRIORITY,
  MEMBER_COL_MIN_WIDTH,
  MEMBER_NAME_COL_MIN_WIDTH,
  MEMBER_ROLE_COL_MIN_WIDTH,
  memberTableColWidth,
} from "@/features/members/hooks/use-auto-hidden-table-columns"
