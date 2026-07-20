create index if not exists payment_provider_alerts_user_id_idx
  on public.payment_provider_alerts(user_id);

drop policy if exists plopplop_deposits_select_own on public.plopplop_deposits;
drop policy if exists plopplop_deposits_select_admin on public.plopplop_deposits;

create policy plopplop_deposits_select_authorized
on public.plopplop_deposits
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.role in ('admin','super_admin')
  )
);

drop policy if exists payment_provider_alerts_select_admin on public.payment_provider_alerts;
create policy payment_provider_alerts_select_admin
on public.payment_provider_alerts
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.role in ('admin','super_admin')
  )
);
