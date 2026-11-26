-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 338 · Revertir los pagos de una deuda (helper interno)   ║
-- ║                                                                     ║
-- ║  Hasta hoy no existía forma de deshacer un pago a proveedor (la 144 ║
-- ║  lo anota como limitación conocida). Este helper deshace lo que     ║
-- ║  hizo fn_pagar_cuenta v7 (mig 155) para TODOS los pagos de una      ║
-- ║  deuda: la plata vuelve a la cuenta de la que salió (movimiento     ║
-- ║  inverso), y se borran el gasto, su asiento y el pago.              ║
-- ║                                                                     ║
-- ║  El movimiento inverso lleva referencia_tipo 'cuenta_a_pagar', el   ║
-- ║  mismo del pago: getSaldoCajaFuerte netea ese circuito y no dispara ║
-- ║  un descuadre falso cuando el pago había salido de la caja fuerte.  ║
-- ║                                                                     ║
-- ║  p_aplicar = false → no escribe nada: devuelve la lista de lo que   ║
-- ║  revertiría (para la confirmación en pantalla).                     ║
-- ║                                                                     ║
-- ║  INTERNO: solo lo llama fn_eliminar_factura_compra (mig 342), que   ║
-- ║  es la que valida permiso y período. No se expone a la API.         ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_int_revertir_pagos_cuenta(
  p_cuenta_id integer,
  p_usuario_id uuid,
  p_aplicar boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
  v_proveedor text;
  v_pago record;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_lista jsonb := '[]'::jsonb;
begin
  select p.nombre into v_proveedor
    from public.cuentas_a_pagar c
    left join public.proveedores p on p.id = c.proveedor_id
   where c.id = p_cuenta_id;

  for v_pago in
    select pg.id, pg.monto, pg.fecha, pg.cuenta_origen_id, pg.egreso_id,
           pg.forma_pago, cu.nombre as cuenta_nombre
      from public.pagos_cuenta pg
      left join public.cuentas cu on cu.id = pg.cuenta_origen_id
     where pg.cuenta_a_pagar_id = p_cuenta_id
     order by pg.id
  loop
    v_lista := v_lista || jsonb_build_object(
      'monto', v_pago.monto,
      'fecha', v_pago.fecha,
      'cuenta', coalesce(v_pago.cuenta_nombre, 'sin cuenta'),
      'forma_pago', v_pago.forma_pago
    );

    continue when not p_aplicar;

    -- La plata vuelve a la cuenta de origen.
    if v_pago.cuenta_origen_id is not null then
      select saldo_actual into v_saldo
        from public.cuentas where id = v_pago.cuenta_origen_id for update;
      if v_saldo is not null then
        v_saldo_nuevo := v_saldo + v_pago.monto;
        insert into public.movimientos_cuenta (
          cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
          descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
        ) values (
          v_pago.cuenta_origen_id, 'ingreso', v_pago.monto, v_saldo, v_saldo_nuevo,
          'Factura eliminada · se revierte el pago a ' || coalesce(v_proveedor, 'proveedor')
            || ' · cuenta #' || p_cuenta_id,
          'pago_proveedores', 'cuenta_a_pagar', p_cuenta_id, p_usuario_id, v_hoy
        );
        update public.cuentas
          set saldo_actual = v_saldo_nuevo, updated_at = now()
          where id = v_pago.cuenta_origen_id;
      end if;
    end if;

    -- El gasto y su asiento (origen 'egreso', mig 155) dejan de existir.
    if v_pago.egreso_id is not null then
      delete from public.asientos where origen = 'egreso' and referencia_id = v_pago.egreso_id;
      delete from public.egresos where id = v_pago.egreso_id;
    end if;

    delete from public.pagos_cuenta where id = v_pago.id;
  end loop;

  if p_aplicar then
    -- Lo que estaba agendado para más adelante ya no se va a pagar.
    update public.pagos_programados
      set estado = 'cancelado'
      where cuenta_a_pagar_id = p_cuenta_id and estado = 'pendiente';
    delete from public.cuotas_cuenta_pagar where cuenta_a_pagar_id = p_cuenta_id;
    update public.cuentas_a_pagar
      set monto_pagado = 0, fecha_pago = null,
          estado = case when estado = 'pagada'::public.estado_cuenta_pagar
                        then 'pendiente'::public.estado_cuenta_pagar else estado end
      where id = p_cuenta_id;
  end if;

  return v_lista;
end;
$$;

revoke all on function public.fn_int_revertir_pagos_cuenta(integer, uuid, boolean)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
