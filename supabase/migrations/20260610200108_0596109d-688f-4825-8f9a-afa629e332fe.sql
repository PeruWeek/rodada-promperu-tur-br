REVOKE EXECUTE ON FUNCTION public.admin_list_orphan_exhibitors() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_orphan_exhibitors() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_orphan_exhibitors() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_orphan_exhibitors() TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_list_unpublished_exhibitors() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_unpublished_exhibitors() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_unpublished_exhibitors() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_unpublished_exhibitors() TO service_role;