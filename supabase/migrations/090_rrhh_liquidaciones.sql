-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 090 · RRHH Sprint 4 — Liquidaciones (modelo nuevo D5)      ║
-- ║                                                                     ║
-- ║  Reemplaza el flujo legacy global-por-período                        ║
-- ║  (fn_liquidar_periodo / liquidaciones / recibos_sueldo) por un       ║
-- ║  modelo POR-EMPLEADO con SNAPSHOT inmutable y detalle de conceptos   ║
-- ║  estilo asiento. Lee la asistencia real (Sprint 2) y el sueldo       ║
-- ║  gateado (Sprint 1) — nada de cargar horas extra a mano.             ║
-- ║                                                                     ║
-- ║  Decisiones de negocio (confirmadas con el dueño, 2026-06-12):       ║
-- ║   · TODOS EN NEGRO/informal → SIN retención de aportes ni asiento    ║
-- ║     de cargas sociales. Neto = haberes − adelantos − consumo cta.cte.║
-- ║   · Conceptos: básico + presentismo 8.33% (se pierde con >3          ║
-- ║     tardanzas o >1 ausencia injustificada) + HE 50/100 AUTOMÁTICAS   ║
-- ║     desde asistencia_diaria. Sin antigüedad.                         ║
-- ║   · SAC versión simple = medio básico vigente, sólo junio/diciembre. ║
-- ║   · Liquidación MENSUAL (calendario). Los adelantos del mes          ║
-- ║     descuentan del neto.                                             ║
-- ║                                                                     ║
-- ║  Tablas nuevas: liquidacion_lote, liquidacion_recibo,               ║
-- ║                 liquidacion_renglon, feriados.                       ║
-- ║  RPCs: fn_generar_liquidacion / fn_confirmar_liquidacion /          ║
-- ║        fn_pagar_liquidacion (security definer, gateadas).            ║
-- ║                                                                     ║
-- ║  El legacy (liquidaciones / recibos_sueldo) queda como HISTÓRICO de  ║
-- ║  sólo lectura: no se borra ni se migra. Sus 3 RPCs SÍ se dropean     ║
-- ║  (la firma de confirmar/pagar coincide pero cambia el tipo de        ║
-- ║  retorno → CREATE OR REPLACE no alcanza, hay que dropear).           ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 0. Retiro de las 3 RPCs legacy (ANTES de crear las nuevas) ──────────
-- fn_confirmar/fn_pagar nuevas comparten la firma (integer,uuid) /
-- (integer,integer,uuid) con las legacy, pero cambian el tipo de retorno
-- (liquidaciones → liquidacion_lote). CREATE OR REPLACE NO puede cambiar el
-- tipo de retorno → hay que dropearlas primero o el CREATE de abajo falla.
drop function if exists public.fn_liquidar_periodo(text, numeric, uuid);
drop function if exists public.fn_confirmar_liquidacion(integer, uuid);
drop function if exists public.fn_pagar_liquidacion(integer, integer, uuid);

-- ─── 1. Cuenta nueva del plan: Anticipos al Personal ─────────────────────
-- Contrapartida balanceada de los descuentos del recibo (adelantos, otros
-- descuentos y consumo de cta. cte.) en el asiento de devengamiento. El
-- legacy dejaba el asiento DESCUADRADO (debe = bruto, haber = neto + aportes,
-- sin contabilizar adelantos/cta.cte.). Acá se cierra esa contrapartida.
insert into public.plan_cuentas (codigo, nombre, tipo, imputable) values
  ('1.1.07', 'Anticipos al Personal', 'activo', true)
on conflict (codigo) do nothing;

-- ─── 2. Calendario de feriados ───────────────────────────────────────────
-- Para reclasificar las horas extra de feriados al 100% (la asistencia
-- sólo distingue domingo por día de semana, no tiene feriados). Editable
-- desde RRHH; se cargan los trasladables/provinciales a mano.
create table if not exists public.feriados (
  fecha      date primary key,
  nombre     text not null,
  ambito     text not null default 'nacional',   -- nacional|provincial
  created_at timestamptz not null default now()
);

-- Inamovibles nacionales 2026 (fecha fija, no se trasladan). Carnaval,
-- Viernes Santo y los trasladables (Güemes, San Martín, Diversidad,
-- Soberanía) se cargan a mano cada año por variar de fecha.
insert into public.feriados (fecha, nombre, ambito) values
  ('2026-01-01', 'Año Nuevo', 'nacional'),
  ('2026-03-24', 'Día Nacional de la Memoria', 'nacional'),
  ('2026-04-02', 'Día del Veterano y de los Caídos en Malvinas', 'nacional'),
  ('2026-05-01', 'Día del Trabajador', 'nacional'),
  ('2026-05-25', 'Día de la Revolución de Mayo', 'nacional'),
  ('2026-06-20', 'Paso a la Inmortalidad del Gral. Belgrano', 'nacional'),
  ('2026-07-09', 'Día de la Independencia', 'nacional'),
  ('2026-12-08', 'Inmaculada Concepción de María', 'nacional'),
  ('2026-12-25', 'Navidad', 'nacional')
on conflict (fecha) do nothing;

-- ─── 3. Cabecera de lote (un proceso de liquidación de un período) ───────
create table if not exists public.liquidacion_lote (
  id                 serial primary key,
  periodo            text not null,                    -- YYYY-MM
  tipo               text not null default 'mensual',  -- mensual|ajuste (futuro)
  estado             text not null default 'borrador', -- borrador|confirmada|pagada
  total_remunerativo numeric(14,2) not null default 0,
  total_descuentos   numeric(14,2) not null default 0,
  total_neto         numeric(14,2) not null default 0,
  asiento_id         integer references public.asientos(id),
  cuenta_id          integer references public.cuentas(id),
  fecha_pago         date,
  usuario_id         uuid references public.usuarios(id),
  created_at         timestamptz not null default now(),
  confirmada_at      timestamptz,
  -- Sin UNIQUE(periodo) global del legacy: permite una mensual + futuras
  -- complementarias del mismo mes. Sí impide dos lotes del mismo tipo.
  unique (periodo, tipo)
);

-- ─── 4. Recibo por empleado (SNAPSHOT inmutable de inputs y totales) ─────
create table if not exists public.liquidacion_recibo (
  id                  serial primary key,
  lote_id             integer not null references public.liquidacion_lote(id) on delete cascade,
  empleado_id         integer not null references public.empleados(id),
  -- snapshot de los inputs al momento de generar (congelado: si después se
  -- reabre la asistencia o cambia el sueldo, el recibo NO muta).
  sueldo_basico       numeric(14,2) not null default 0,
  valor_hora          numeric(14,2) not null default 0,
  dias_trabajados     integer not null default 0,
  dias_ausente_injust integer not null default 0,
  tardanzas           integer not null default 0,
  he50_horas          numeric(6,2) not null default 0,
  he100_horas         numeric(6,2) not null default 0,
  presentismo_perdido boolean not null default false,
  -- totales calculados
  total_remunerativo  numeric(14,2) not null default 0,
  total_descuentos    numeric(14,2) not null default 0,
  neto                numeric(14,2) not null default 0,
  pagado              boolean not null default false,
  fecha_pago          date,
  created_at          timestamptz not null default now(),
  unique (lote_id, empleado_id)
);
create index if not exists liq_recibo_lote_idx on public.liquidacion_recibo (lote_id);
create index if not exists liq_recibo_empleado_idx on public.liquidacion_recibo (empleado_id);

-- ─── 5. Renglones del recibo (detalle de conceptos, estilo asiento) ─────
create table if not exists public.liquidacion_renglon (
  id          serial primary key,
  recibo_id   integer not null references public.liquidacion_recibo(id) on delete cascade,
  codigo      text not null,    -- basico|presentismo|he_50|he_100|sac|bono|otro|adelanto|descuento|ctacte
  clase       text not null,    -- haber|descuento
  descripcion text not null,
  base        numeric(14,2),    -- base de cálculo (ej. básico, valor_hora)
  cantidad    numeric(10,2),    -- ej. cantidad de horas
  monto       numeric(14,2) not null,   -- SIEMPRE positivo; el signo lo da `clase`
  orden       integer not null default 0
);
create index if not exists liq_renglon_recibo_idx on public.liquidacion_renglon (recibo_id);

-- ─── 6. Enganche con cuenta corriente del empleado ───────────────────────
-- El consumo descontado se vincula al recibo NUEVO (no al legacy recibo_id)
-- para que, si se regenera el borrador, el movimiento caiga en cascade y el
-- saldo del empleado reaparezca. El "saldo disponible" para descontar es el
-- que no está consumido por NINGÚN recibo (legacy ni nuevo).
alter table public.cuenta_corriente_empleado
  add column if not exists liquidacion_recibo_id integer
    references public.liquidacion_recibo(id) on delete cascade;
create index if not exists cce_liq_recibo_idx
  on public.cuenta_corriente_empleado (liquidacion_recibo_id);

-- ─── 7. RPC: generar (o regenerar) el borrador de un período ─────────────
create or replace function public.fn_generar_liquidacion(
  p_periodo text,
  p_usuario_id uuid
) returns public.liquidacion_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.liquidacion_lote;
  v_emp record;
  v_desde date;
  v_hasta date;
  v_hasta_cierre date;
  v_dia date;
  v_mes int;
  -- config (con defaults defensivos por si falta la clave)
  v_divisor numeric := 200;
  v_pres_pct numeric := 8.33;
  v_pres_max_tard int := 3;
  v_pres_max_aus int := 1;
  v_f50 numeric := 1.5;
  v_f100 numeric := 2.0;
  -- por empleado
  v_basico numeric;
  v_valor_hora numeric;
  v_dias_trab int;
  v_tardanzas int;
  v_ausencias int;
  v_he50_raw numeric;
  v_he100_raw numeric;
  v_he50_feriado numeric;
  v_he50 numeric;
  v_he100 numeric;
  v_pres_perdido boolean;
  v_bono numeric;
  v_otro numeric;
  v_adelanto numeric;
  v_descuento numeric;
  v_saldo_cta numeric;
  v_desc_cta numeric;
  v_presentismo numeric;
  v_sac numeric;
  v_imp_he50 numeric;
  v_imp_he100 numeric;
  v_remunerativo numeric;
  v_descuentos numeric;
  v_neto numeric;
  v_recibo_id integer;
  v_orden int;
  v_tot_rem numeric := 0;
  v_tot_desc numeric := 0;
  v_tot_neto numeric := 0;
begin
  -- Sólo 'rrhh_sueldos' (solo admin). La RPC es definer → sin este chequeo,
  -- cualquier autenticado podría liquidar por rpc saltando la RLS.
  if not public.fn_tiene_permiso('rrhh_sueldos') then
    raise exception 'Sin permiso para liquidar sueldos.';
  end if;

  if p_periodo !~ '^\d{4}-\d{2}$' then
    raise exception 'Período inválido (se espera YYYY-MM): %', p_periodo;
  end if;

  v_desde := (p_periodo || '-01')::date;
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  v_mes := split_part(p_periodo, '-', 2)::int;

  -- No se puede regenerar un período ya confirmado/pagado.
  if exists (
    select 1 from public.liquidacion_lote
    where periodo = p_periodo and tipo = 'mensual' and estado <> 'borrador'
  ) then
    raise exception 'Ya existe una liquidación cerrada para el período %.', p_periodo;
  end if;

  -- Forzar el cierre de la asistencia de los días ya pasados del período, para
  -- que las ausencias injustificadas (que dependen del cron de las 6am) estén
  -- completas antes de contar presentismo. Idempotente.
  v_hasta_cierre := least(v_hasta, current_date);
  v_dia := v_desde;
  while v_dia <= v_hasta_cierre loop
    perform public.fn_cerrar_dia_asistencia(v_dia);
    v_dia := v_dia + 1;
  end loop;

  -- Borrar el borrador anterior (recibos, renglones y movimientos de cta.cte.
  -- vinculados caen en cascade → el saldo de consumo reaparece).
  delete from public.liquidacion_lote
    where periodo = p_periodo and tipo = 'mensual' and estado = 'borrador';

  insert into public.liquidacion_lote (periodo, tipo, estado, usuario_id)
  values (p_periodo, 'mensual', 'borrador', p_usuario_id)
  returning * into v_lote;

  -- Parámetros de rrhh_config (nada hardcodeado; defaults si falta la clave).
  select coalesce((valor #>> '{}')::numeric, v_divisor)      into v_divisor      from public.rrhh_config where clave = 'divisor_valor_hora';
  select coalesce((valor #>> '{}')::numeric, v_pres_pct)     into v_pres_pct     from public.rrhh_config where clave = 'presentismo_porcentaje';
  select coalesce((valor #>> '{}')::int,     v_pres_max_tard) into v_pres_max_tard from public.rrhh_config where clave = 'presentismo_max_tardanzas';
  select coalesce((valor #>> '{}')::int,     v_pres_max_aus)  into v_pres_max_aus  from public.rrhh_config where clave = 'presentismo_max_ausencias';
  select coalesce((valor #>> '{}')::numeric, v_f50)          into v_f50          from public.rrhh_config where clave = 'hora_extra_50_factor';
  select coalesce((valor #>> '{}')::numeric, v_f100)         into v_f100         from public.rrhh_config where clave = 'hora_extra_100_factor';

  -- Guarda: un divisor 0/null dejaría el valor_hora en null y rompería los
  -- importes de HE (y el insert NOT NULL). Volvemos al default.
  if v_divisor is null or v_divisor = 0 then v_divisor := 200; end if;

  for v_emp in
    select id from public.empleados where activo = true order by id
  loop
    v_basico := coalesce(public.fn_sueldo(v_emp.id), 0);
    v_valor_hora := round(v_basico / nullif(v_divisor, 0), 2);

    -- Asistencia agregada del período (+ horas extra de feriados a reclasificar).
    select
      coalesce(count(*) filter (where ad.estado in ('presente','tardanza','sin_turno') and ad.marcaciones >= 2), 0),
      coalesce(count(*) filter (where ad.estado = 'tardanza'), 0),
      coalesce(count(*) filter (where ad.estado = 'ausente_injustificado'), 0),
      coalesce(sum(ad.horas_extra_50), 0),
      coalesce(sum(ad.horas_extra_100), 0),
      coalesce(sum(ad.horas_extra_50) filter (where f.fecha is not null), 0)
    into v_dias_trab, v_tardanzas, v_ausencias, v_he50_raw, v_he100_raw, v_he50_feriado
    from public.asistencia_diaria ad
    left join public.feriados f on f.fecha = ad.fecha
    where ad.empleado_id = v_emp.id
      and ad.fecha between v_desde and v_hasta;

    -- Las HE de feriados pasan del 50% al 100% (el domingo ya viene al 100%
    -- desde la asistencia). NOTA: el prorrateo por tramo horario del turno
    -- noche que cruza a domingo/feriado sigue sin partirse (limitación
    -- heredada del Sprint 2); se reclasifica el día completo, no la fracción.
    v_he100 := v_he100_raw + v_he50_feriado;
    v_he50  := greatest(0, v_he50_raw - v_he50_feriado);

    v_pres_perdido := (v_tardanzas > v_pres_max_tard) or (v_ausencias > v_pres_max_aus);

    -- Novedades manuales del período. hora_extra/presentismo ya NO se toman a
    -- mano (son automáticas); sólo entran bono y otro como haberes.
    select
      coalesce(sum(monto) filter (where tipo = 'bono'), 0),
      coalesce(sum(monto) filter (where tipo = 'otro'), 0),
      coalesce(sum(monto) filter (where tipo = 'adelanto'), 0),
      coalesce(sum(monto) filter (where tipo = 'descuento'), 0)
    into v_bono, v_otro, v_adelanto, v_descuento
    from public.novedades_empleado
    where empleado_id = v_emp.id and periodo = p_periodo;

    -- Conceptos remunerativos (haberes).
    v_presentismo := case when v_pres_perdido then 0
                          else round(v_basico * v_pres_pct / 100, 2) end;
    v_sac := case when v_mes in (6, 12) then round(v_basico * 0.5, 2) else 0 end;
    v_imp_he50  := round(v_he50  * v_valor_hora * v_f50, 2);
    v_imp_he100 := round(v_he100 * v_valor_hora * v_f100, 2);

    v_remunerativo := v_basico + v_presentismo + v_imp_he50 + v_imp_he100
                      + v_sac + v_bono + v_otro;

    -- Saldo de consumo de cta. cte. todavía no descontado por ningún recibo
    -- (ni legacy ni del modelo nuevo).
    select coalesce(sum(monto), 0)
      into v_saldo_cta
      from public.cuenta_corriente_empleado
      where empleado_id = v_emp.id
        and recibo_id is null
        and liquidacion_recibo_id is null;

    -- Tope: el consumo se descuenta SÓLO hasta donde alcanza el haber tras los
    -- adelantos/otros descuentos del mes. El remanente queda como saldo vivo
    -- (sin vincular) y se descuenta el mes siguiente → el neto nunca baja de
    -- cero por consumo, y el comercio no "cobra" deuda que el sueldo no cubrió.
    v_desc_cta := least(
      greatest(0, v_saldo_cta),
      greatest(0, v_remunerativo - v_adelanto - v_descuento)
    );

    v_descuentos := v_adelanto + v_descuento + v_desc_cta;
    v_neto := v_remunerativo - v_descuentos;

    -- Si los adelantos/otros descuentos manuales por sí solos ya superan el
    -- haber, el recibo daría neto negativo: se aborta para que el dueño corrija
    -- la novedad, en vez de emitir un recibo (y un asiento) inconsistente.
    if v_neto < 0 then
      raise exception
        'El recibo del empleado id=% da neto negativo (%). Revisá los adelantos/descuentos del período %.',
        v_emp.id, v_neto, p_periodo;
    end if;

    insert into public.liquidacion_recibo (
      lote_id, empleado_id, sueldo_basico, valor_hora,
      dias_trabajados, dias_ausente_injust, tardanzas,
      he50_horas, he100_horas, presentismo_perdido,
      total_remunerativo, total_descuentos, neto
    ) values (
      v_lote.id, v_emp.id, v_basico, v_valor_hora,
      v_dias_trab, v_ausencias, v_tardanzas,
      v_he50, v_he100, v_pres_perdido,
      v_remunerativo, v_descuentos, v_neto
    ) returning id into v_recibo_id;

    -- Renglones (detalle). Sólo se insertan los conceptos con monto > 0,
    -- salvo el básico que siempre va.
    v_orden := 0;
    insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
      values (v_recibo_id, 'basico', 'haber', 'Sueldo básico', null, null, v_basico, v_orden);
    v_orden := v_orden + 1;

    if v_presentismo > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'presentismo', 'haber',
                format('Presentismo %s%%', v_pres_pct), v_basico, null, v_presentismo, v_orden);
      v_orden := v_orden + 1;
    end if;

    if v_imp_he50 > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'he_50', 'haber',
                format('Horas extra 50%% (%s h)', v_he50), v_valor_hora, v_he50, v_imp_he50, v_orden);
      v_orden := v_orden + 1;
    end if;

    if v_imp_he100 > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'he_100', 'haber',
                format('Horas extra 100%% (%s h)', v_he100), v_valor_hora, v_he100, v_imp_he100, v_orden);
      v_orden := v_orden + 1;
    end if;

    if v_sac > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'sac', 'haber', 'SAC (½ aguinaldo)', v_basico, null, v_sac, v_orden);
      v_orden := v_orden + 1;
    end if;

    if v_bono > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'bono', 'haber', 'Bonos (novedades)', null, null, v_bono, v_orden);
      v_orden := v_orden + 1;
    end if;

    if v_otro > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'otro', 'haber', 'Otros haberes (novedades)', null, null, v_otro, v_orden);
      v_orden := v_orden + 1;
    end if;

    if v_adelanto > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'adelanto', 'descuento', 'Adelantos del mes', null, null, v_adelanto, v_orden);
      v_orden := v_orden + 1;
    end if;

    if v_descuento > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'descuento', 'descuento', 'Otros descuentos (novedades)', null, null, v_descuento, v_orden);
      v_orden := v_orden + 1;
    end if;

    if v_desc_cta > 0 then
      insert into public.liquidacion_renglon (recibo_id, codigo, clase, descripcion, base, cantidad, monto, orden)
        values (v_recibo_id, 'ctacte', 'descuento', 'Consumo cuenta corriente', null, null, v_desc_cta, v_orden);
      v_orden := v_orden + 1;

      -- Cancela el saldo de consumo, vinculado al recibo nuevo (reversible).
      insert into public.cuenta_corriente_empleado (
        empleado_id, fecha, tipo, concepto, monto, liquidacion_recibo_id, usuario_id
      ) values (
        v_emp.id, current_date, 'descuento_sueldo',
        format('Liquidación %s', p_periodo),
        -v_desc_cta, v_recibo_id, p_usuario_id
      );
    end if;

    v_tot_rem  := v_tot_rem  + v_remunerativo;
    v_tot_desc := v_tot_desc + v_descuentos;
    v_tot_neto := v_tot_neto + v_neto;
  end loop;

  update public.liquidacion_lote
    set total_remunerativo = v_tot_rem,
        total_descuentos   = v_tot_desc,
        total_neto         = v_tot_neto
    where id = v_lote.id
    returning * into v_lote;

  return v_lote;
end $$;

grant execute on function public.fn_generar_liquidacion(text, uuid) to authenticated;

-- ─── 8. RPC: confirmar (asiento de devengamiento BALANCEADO) ─────────────
create or replace function public.fn_confirmar_liquidacion(
  p_lote_id integer,
  p_usuario_id uuid
) returns public.liquidacion_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.liquidacion_lote;
  v_fecha_asiento date;
  v_asiento_id integer;
  v_cta_sueldos integer;   -- 5.2.01 Sueldos y Jornales (egreso)
  v_cta_apagar integer;    -- 2.1.03 Sueldos a Pagar (pasivo)
  v_cta_anticipos integer; -- 1.1.07 Anticipos al Personal (activo)
  v_orden integer := 0;
begin
  if not public.fn_tiene_permiso('rrhh_sueldos') then
    raise exception 'Sin permiso para liquidar sueldos.';
  end if;

  select * into v_lote from public.liquidacion_lote where id = p_lote_id;
  if v_lote.id is null then
    raise exception 'La liquidación no existe.';
  end if;
  if v_lote.estado <> 'borrador' then
    raise exception 'La liquidación ya fue confirmada.';
  end if;
  -- Defensa: con el tope de cta.cte. el neto del lote nunca debería ser
  -- negativo; si lo fuera, no devengar (evita un HABER negativo en 2.1.03).
  if v_lote.total_neto < 0 then
    raise exception 'El neto total es negativo; revisá adelantos/descuentos antes de confirmar.';
  end if;

  -- El costo laboral se devenga en el MES LIQUIDADO, no en "hoy": el asiento se
  -- fecha el último día del período (capado a hoy si se pre-liquida). Así el
  -- candado de cierre se evalúa sobre ESE mes, igual que fn_anular_venta /
  -- fn_guardar_factura_compra.
  v_fecha_asiento := least(
    ((v_lote.periodo || '-01')::date + interval '1 month' - interval '1 day')::date,
    current_date
  );
  if public.fn_periodo_cerrado(v_fecha_asiento) then
    raise exception 'El período contable % está cerrado; no se puede confirmar.',
      to_char(v_fecha_asiento, 'YYYY-MM');
  end if;

  select id into v_cta_sueldos   from public.plan_cuentas where codigo = '5.2.01';
  select id into v_cta_apagar    from public.plan_cuentas where codigo = '2.1.03';
  select id into v_cta_anticipos from public.plan_cuentas where codigo = '1.1.07';

  if v_lote.total_remunerativo > 0 then
    -- Fail-loud: una liquidación no se marca confirmada sin contrapartida
    -- contable real (las cuentas son de sistema, deberían existir siempre).
    if v_cta_sueldos is null or v_cta_apagar is null then
      raise exception 'Faltan cuentas del plan (5.2.01 / 2.1.03); no se puede devengar.';
    end if;
    if v_lote.total_descuentos > 0 and v_cta_anticipos is null then
      raise exception 'Falta la cuenta 1.1.07 Anticipos al Personal.';
    end if;

    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (
      v_fecha_asiento, 'Sueldos ' || v_lote.periodo,
      'automatico', 'liquidacion', v_lote.id, p_usuario_id
    )
    returning id into v_asiento_id;

    -- DEBE Sueldos y Jornales = remunerativo (el costo laboral del mes).
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_sueldos, v_lote.total_remunerativo, 0, v_orden);
    v_orden := v_orden + 1;

    -- HABER Sueldos a Pagar = neto (lo que se le debe al empleado).
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_apagar, 0, v_lote.total_neto, v_orden);
    v_orden := v_orden + 1;

    -- HABER Anticipos al Personal = descuentos (adelantos + otros + cta.cte.):
    -- cancela los anticipos/consumos que el personal ya recibió. Balancea el
    -- asiento (debe = haber = remunerativo).
    if v_lote.total_descuentos > 0 then
      insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
      values (v_asiento_id, v_cta_anticipos, 0, v_lote.total_descuentos, v_orden);
    end if;
  end if;

  update public.liquidacion_lote
    set estado = 'confirmada', confirmada_at = now(), asiento_id = v_asiento_id
    where id = v_lote.id
    returning * into v_lote;

  return v_lote;
end $$;

grant execute on function public.fn_confirmar_liquidacion(integer, uuid) to authenticated;

-- ─── 9. RPC: pagar (egreso de tesorería + asiento de pago) ───────────────
create or replace function public.fn_pagar_liquidacion(
  p_lote_id integer,
  p_cuenta_id integer,
  p_usuario_id uuid
) returns public.liquidacion_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.liquidacion_lote;
  v_saldo numeric;
  v_tipo public.tipo_cuenta;
  v_hoy date := current_date;
  v_asiento_id integer;
  v_cta_apagar integer;
  v_cta_dinero integer;
begin
  if not public.fn_tiene_permiso('rrhh_sueldos') then
    raise exception 'Sin permiso para liquidar sueldos.';
  end if;

  select * into v_lote from public.liquidacion_lote where id = p_lote_id;
  if v_lote.id is null then
    raise exception 'La liquidación no existe.';
  end if;
  if v_lote.estado = 'borrador' then
    raise exception 'Primero confirmá la liquidación.';
  end if;
  if v_lote.estado = 'pagada' then
    raise exception 'La liquidación ya está pagada.';
  end if;

  if v_lote.total_neto < 0 then
    raise exception 'El neto total es negativo; revisá la liquidación antes de pagar.';
  end if;

  -- El pago es un egreso de HOY (cuándo sale la plata), por eso se fecha y se
  -- gatea con la fecha actual (a diferencia del devengamiento, que va al mes).
  if public.fn_periodo_cerrado(v_hoy) then
    raise exception 'El período contable de hoy está cerrado; no se puede pagar.';
  end if;

  select saldo_actual, tipo into v_saldo, v_tipo
    from public.cuentas where id = p_cuenta_id for update;
  if v_saldo is null then
    raise exception 'La cuenta de pago no existe.';
  end if;

  -- Cuentas del asiento de pago: se resuelven y validan ANTES de mover plata,
  -- para no descontar el saldo sin poder asentar la contrapartida.
  select id into v_cta_apagar from public.plan_cuentas where codigo = '2.1.03';
  select id into v_cta_dinero from public.plan_cuentas
    where codigo = case when v_tipo = 'caja' then '1.1.01' else '1.1.02' end;
  if v_lote.total_neto > 0 and (v_cta_apagar is null or v_cta_dinero is null) then
    raise exception 'Faltan cuentas del plan (2.1.03 / 1.1.01 / 1.1.02); no se puede asentar el pago.';
  end if;

  -- Egreso de tesorería por el neto total.
  if v_lote.total_neto > 0 then
    insert into public.movimientos_cuenta (
      cuenta_id, tipo, monto, saldo_anterior, saldo_nuevo,
      descripcion, categoria, referencia_tipo, referencia_id, usuario_id, fecha
    ) values (
      p_cuenta_id, 'egreso', v_lote.total_neto,
      v_saldo, v_saldo - v_lote.total_neto,
      'Pago de sueldos ' || v_lote.periodo, 'sueldos',
      'liquidacion', v_lote.id, p_usuario_id, v_hoy
    );
    update public.cuentas
      set saldo_actual = v_saldo - v_lote.total_neto, updated_at = now()
      where id = p_cuenta_id;

    -- Asiento de pago: DEBE Sueldos a Pagar / HABER Caja|Bancos.
    insert into public.asientos (fecha, descripcion, tipo, origen, referencia_id, usuario_id)
    values (
      v_hoy, 'Pago sueldos ' || v_lote.periodo,
      'automatico', 'pago_sueldos', v_lote.id, p_usuario_id
    )
    returning id into v_asiento_id;
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_apagar, v_lote.total_neto, 0, 0);
    insert into public.asientos_items (asiento_id, cuenta_id, debe, haber, orden)
    values (v_asiento_id, v_cta_dinero, 0, v_lote.total_neto, 1);
  end if;

  update public.liquidacion_recibo
    set pagado = true, fecha_pago = v_hoy
    where lote_id = v_lote.id;

  update public.liquidacion_lote
    set estado = 'pagada', cuenta_id = p_cuenta_id, fecha_pago = v_hoy
    where id = v_lote.id
    returning * into v_lote;

  return v_lote;
end $$;

grant execute on function public.fn_pagar_liquidacion(integer, integer, uuid) to authenticated;

-- ─── 10. Histórico legacy ────────────────────────────────────────────────
-- Las tablas legacy liquidaciones / recibos_sueldo quedan INTACTAS como
-- histórico de sólo lectura. No se borran ni se migran (sus 3 RPCs ya se
-- retiraron en el bloque 0).

-- ─── 11. RLS de las tablas nuevas ────────────────────────────────────────
create or replace function public.fn__rls_gate(p_tabla text, p_permiso text)
returns void language plpgsql as $$
declare v_pol text;
begin
  for v_pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = p_tabla
  loop
    execute format('drop policy %I on public.%I', v_pol, p_tabla);
  end loop;
  execute format('alter table public.%I enable row level security', p_tabla);
  execute format(
    'create policy "gate_rw" on public.%I for all to authenticated '
    || 'using (public.fn_tiene_permiso(%L)) with check (public.fn_tiene_permiso(%L))',
    p_tabla, p_permiso, p_permiso);
end $$;

-- Tablas con monto salarial → 'rrhh_sueldos' (solo admin).
select public.fn__rls_gate('liquidacion_lote',    'rrhh_sueldos');
select public.fn__rls_gate('liquidacion_recibo',  'rrhh_sueldos');
select public.fn__rls_gate('liquidacion_renglon', 'rrhh_sueldos');

drop function if exists public.fn__rls_gate(text, text);

-- feriados: lectura para cualquier autenticado (la usa la liquidación y es
-- info pública); escritura sólo 'rrhh' (operativo).
alter table public.feriados enable row level security;
drop policy if exists "feriados_select" on public.feriados;
drop policy if exists "feriados_write"  on public.feriados;
create policy "feriados_select" on public.feriados for select to authenticated
  using (true);
create policy "feriados_write" on public.feriados for all to authenticated
  using (public.fn_tiene_permiso('rrhh'))
  with check (public.fn_tiene_permiso('rrhh'));

notify pgrst, 'reload schema';
