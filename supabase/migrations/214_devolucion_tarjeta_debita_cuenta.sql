-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 214 · Devolución "reverso a tarjeta" debita la cuenta    ║
-- ║                                                                     ║
-- ║  Reclamo: "la cuenta de Mercado Pago nunca coincide con el saldo".  ║
-- ║  Una causa: fn_crear_devolucion (171) con reembolso 'tarjeta' solo  ║
-- ║  ajusta las acreditaciones PENDIENTES de la venta. Con los medios   ║
-- ║  de acreditación instantánea (todos los mp2_*), o si la             ║
-- ║  acreditación ya se acreditó, la plata YA estaba en la cuenta: MP   ║
-- ║  la devuelve al cliente pero el saldo del sistema nunca bajaba.     ║
-- ║                                                                     ║
-- ║  Trigger AFTER INSERT en devoluciones (tipo_reembolso = 'tarjeta'): ║
-- ║   · lo NO cubierto por acreditaciones pendientes (= el v_rest que   ║
-- ║     deja fn_crear_devolucion) ya entró a una cuenta;                ║
-- ║   · se revierte en proporción sobre los movimientos que la venta    ║
-- ║     generó (bruto, comisión, IIBB; los mismos que revierte          ║
-- ║     fn_anular_venta): egreso del bruto, ingreso de la comisión y    ║
-- ║     del IIBB proporcionales → la cuenta baja el NETO devuelto.      ║
-- ║  Se usa un trigger y no se re-emite fn_crear_devolucion (358        ║
-- ║  líneas): el insert en devoluciones ocurre ANTES de que la función  ║
-- ║  toque las acreditaciones, así que acá se ven igual que ella.       ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO.                                   ║
-- ╚════════════════════════════════════════════════════════════════════╝

create or replace function public.fn_devolucion_reverso_cuenta()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_pendiente numeric;
  v_resto numeric;
  v_bruto numeric;
  v_ratio numeric;
  v_mov record;
  v_monto numeric;
  v_tipo text;
  v_saldo numeric;
  v_saldo_nuevo numeric;
  v_hoy date := (now() at time zone 'America/Argentina/La_Rioja')::date;
begin
  if new.tipo_reembolso is distinct from 'tarjeta' or coalesce(new.total_devuelto, 0) <= 0 then
    return new;
  end if;

  -- Lo que absorben las acreditaciones pendientes (fn_crear_devolucion las
  -- cancela/achica justo después de este insert).
  select coalesce(sum(monto_bruto), 0) into v_pendiente
    from public.acreditaciones
   where venta_id = new.venta_id and estado = 'pendiente';
  v_resto := new.total_devuelto - least(new.total_devuelto, v_pendiente);
  if v_resto <= 0.009 then
    return new;
  end if;

  -- Bruto que la venta hizo entrar a cuentas (venta instantánea o
  -- acreditación ya acreditada).
  select coalesce(sum(monto), 0) into v_bruto
    from public.movimientos_cuenta
   where tipo = 'ingreso'
     and coalesce(categoria, 'venta') in ('venta', 'acreditacion')
     and ((referencia_tipo = 'venta' and referencia_id = new.venta_id)
       or (referencia_tipo = 'acreditacion' and referencia_id in (
             select id from public.acreditaciones where venta_id = new.venta_id)));
  if v_bruto <= 0 then
    return new;  -- la venta no acreditó ninguna cuenta: nada que revertir
  end if;
  v_ratio := least(v_resto / v_bruto, 1);

  for v_mov in
    select cuenta_id, tipo, monto, categoria
      from public.movimientos_cuenta
     where tipo in ('ingreso', 'egreso')
       and ((referencia_tipo = 'venta' and referencia_id = new.venta_id)
         or (referencia_tipo = 'acreditacion' and referencia_id in (
               select id from public.acreditaciones where venta_id = new.venta_id)))
     order by id
  loop
    v_monto := round(v_mov.monto * v_ratio, 2);
    continue when v_monto <= 0;
    v_tipo := case when v_mov.tipo = 'ingreso' then 'egreso' else 'ingreso' end;
    select saldo_actual into v_saldo from public.cuentas where id = v_mov.cuenta_id for update;
    continue when v_saldo is null;
    v_saldo_nuevo := case when v_tipo = 'ingreso' then v_saldo + v_monto else v_saldo - v_monto end;
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      v_mov.cuenta_id, v_tipo::public.tipo_movimiento_cuenta, v_monto, v_saldo, v_saldo_nuevo,
      'Devolución venta #' || new.venta_id || ' (reverso a tarjeta)',
      case when coalesce(v_mov.categoria, 'venta') in ('venta', 'acreditacion')
           then 'devolucion' else v_mov.categoria end,
      'devolucion', new.id, new.usuario_id, v_hoy
    );
    update public.cuentas set saldo_actual = v_saldo_nuevo, updated_at = now()
     where id = v_mov.cuenta_id;
  end loop;

  return new;
end $$;

drop trigger if exists trg_devolucion_reverso_cuenta on public.devoluciones;
create trigger trg_devolucion_reverso_cuenta
  after insert on public.devoluciones
  for each row execute function public.fn_devolucion_reverso_cuenta();

-- Verificación:
--   select tgname from pg_trigger where tgname = 'trg_devolucion_reverso_cuenta';
--   -- Después de una devolución a tarjeta de una venta MP instantánea: la
--   -- cuenta MP tiene un egreso 'devolucion' y los ingresos de comisión/IIBB.
--   select * from public.movimientos_cuenta where referencia_tipo = 'devolucion'
--    order by id desc limit 10;

notify pgrst, 'reload schema';
