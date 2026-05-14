# -*- coding: utf-8 -*-
"""
Gera o SQL de importação a partir da planilha DadosDoDashBoardAtual.xlsx.
Saída: database/005_import_real_data.sql
"""

import openpyxl
from datetime import datetime
import uuid
import os
import sys

XLSX_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'DadosDoDashBoardAtual.xlsx')
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', '005_import_real_data.sql')

def make_uuid(seed_str):
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, seed_str))

def fmt_date(d):
    if d is None:
        return 'NULL'
    if isinstance(d, datetime):
        return "'" + d.strftime('%Y-%m-%d') + "'"
    return "'" + str(d) + "'"

def fmt_num(n):
    if n is None:
        return '0'
    return f'{float(n):.2f}'

def fmt_text(t):
    if t is None:
        return 'NULL'
    s = str(t).strip().replace("'", "''")
    return "'" + s + "'"

def normalize_project(name):
    """Normaliza nomes de projetos (ex: iCS -> ICS)"""
    if name is None:
        return None
    name = name.strip()
    if name.lower() == 'ics':
        return 'ICS'
    return name

def main():
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
    
    out = []
    out.append('-- ============================================================')
    out.append('-- IMPORTACAO DE DADOS REAIS - Dashboard 2026')
    out.append('-- Gerado automaticamente a partir de DadosDoDashBoardAtual.xlsx')
    out.append('-- ============================================================')
    out.append('--')
    out.append('-- IMPORTANTE: Executar APOS o schema (001_schema.sql).')
    out.append('-- Se ja existirem dados de seed/teste, este script limpa tudo primeiro.')
    out.append('-- ============================================================')
    out.append('')
    out.append('BEGIN;')
    out.append('')
    out.append('-- Limpar dados existentes (ordem inversa das dependencias)')
    out.append('DELETE FROM public.expenses;')
    out.append('DELETE FROM public.funding_releases;')
    out.append('DELETE FROM public.scholarships;')
    out.append('DELETE FROM public.dashboard_settings;')
    out.append('DELETE FROM public.scholarship_holders;')
    out.append('DELETE FROM public.projects;')
    out.append('')
    
    # ========== 1. PROJECTS ==========
    ws = wb['Nomenclaturas']
    projects = {}  # name -> uuid
    proj_lines = []
    
    for row in ws.iter_rows(min_row=2, max_row=100, min_col=1, max_col=6, values_only=True):
        if row[0] is None:
            continue
        name = row[0].strip()
        pid = make_uuid('project-' + name)
        projects[name] = pid
        end_date = row[1]
        initial_balance = row[2] or 0
        yield_amount = row[3] or 0
        rubricas = row[4]
        report_dates = row[5]
        proj_lines.append(
            f"  ('{pid}', {fmt_text(name)}, NULL, NULL, {fmt_date(end_date)}, "
            f"{fmt_num(initial_balance)}, {fmt_num(yield_amount)}, "
            f"{fmt_text(report_dates)}, {fmt_text(rubricas)}, true)"
        )
    
    # Projetos extras referenciados em bolsistas mas ausentes em Nomenclaturas
    ws_bol = wb['Tabela bolsistas']
    extra_projects = set()
    for row in ws_bol.iter_rows(min_row=2, max_row=1000, min_col=1, max_col=6, values_only=True):
        if row[0] and row[1]:
            pname = normalize_project(row[1])
            if pname and pname not in projects:
                extra_projects.add(pname)
    
    for name in sorted(extra_projects):
        pid = make_uuid('project-' + name)
        projects[name] = pid
        proj_lines.append(
            f"  ('{pid}', {fmt_text(name)}, NULL, NULL, NULL, 0.00, 0.00, NULL, "
            f"'Projeto importado da Tabela bolsistas (sem dados em Nomenclaturas)', true)"
        )
    
    # Alias iCS -> ICS
    if 'ICS' in projects:
        projects['iCS'] = projects['ICS']
    
    out.append('-- ============================================================')
    out.append(f'-- 1. PROJETOS ({len(proj_lines)} registros)')
    out.append('-- ============================================================')
    out.append('')
    out.append('INSERT INTO public.projects (id, name, code, start_date, end_date, initial_balance, yield_amount, report_dates, notes, active) VALUES')
    out.append(',\n'.join(proj_lines) + ';')
    out.append('')
    
    # ========== 2. SCHOLARSHIP HOLDERS ==========
    holders = {}  # name -> uuid
    holder_lines = []
    
    for row in ws_bol.iter_rows(min_row=2, max_row=1000, min_col=1, max_col=6, values_only=True):
        if row[0] is None:
            continue
        name = row[0].strip()
        if name not in holders:
            hid = make_uuid('holder-' + name)
            holders[name] = hid
            holder_lines.append(f"  ('{hid}', {fmt_text(name)}, NULL, true)")
    
    out.append('-- ============================================================')
    out.append(f'-- 2. BOLSISTAS - PESSOAS ({len(holder_lines)} registros)')
    out.append('-- ============================================================')
    out.append('')
    out.append('INSERT INTO public.scholarship_holders (id, full_name, email, active) VALUES')
    out.append(',\n'.join(holder_lines) + ';')
    out.append('')
    
    # ========== 3. SCHOLARSHIPS ==========
    scholarship_lines = []
    skipped = 0
    seen_sids = set()  # Track generated UUIDs to handle duplicates
    scholarship_counter = 0
    
    for row in ws_bol.iter_rows(min_row=2, max_row=1000, min_col=1, max_col=6, values_only=True):
        if row[0] is None:
            continue
        scholarship_counter += 1
        holder_name = row[0].strip()
        project_name = normalize_project(row[1])
        amount = row[2]
        start_date = row[3]
        end_date = row[4]
        
        if project_name is None:
            skipped += 1
            continue
        
        if holder_name not in holders:
            skipped += 1
            continue
        if project_name not in projects:
            skipped += 1
            continue
        
        hid = holders[holder_name]
        pid = projects[project_name]
        # Include row counter to guarantee uniqueness even for duplicate rows
        sid = make_uuid(f'scholarship-{holder_name}-{project_name}-{start_date}-{amount}-{scholarship_counter}')
        
        # Safety check: skip if UUID collision (shouldn't happen with counter)
        if sid in seen_sids:
            skipped += 1
            continue
        seen_sids.add(sid)
        
        # Determinar status baseado nas datas
        status = 'active'
        if end_date and isinstance(end_date, datetime):
            if end_date < datetime.now():
                status = 'ended'
        
        scholarship_lines.append(
            f"  ('{sid}', '{hid}', '{pid}', {fmt_num(amount)}, "
            f"{fmt_date(start_date)}, {fmt_date(end_date)}, '{status}', NULL)"
        )
    
    out.append('-- ============================================================')
    out.append(f'-- 3. BOLSAS - VINCULACOES ({len(scholarship_lines)} registros, {skipped} ignorados sem projeto)')
    out.append('-- ============================================================')
    out.append('')
    out.append('INSERT INTO public.scholarships (id, holder_id, project_id, amount, start_date, end_date, status, notes) VALUES')
    out.append(',\n'.join(scholarship_lines) + ';')
    out.append('')
    
    # ========== 4. FUNDING RELEASES ==========
    ws_des = wb['Tabela desembolso']
    release_lines = []
    skipped_rel = 0
    
    for row in ws_des.iter_rows(min_row=2, max_row=200, min_col=6, max_col=9, values_only=True):
        if row[0] is None or row[0] == 'Nome do desembolso':
            continue
        desc = row[0]
        project_name = normalize_project(row[1]) if row[1] else None
        release_date = row[2]
        amount = row[3]
        
        if project_name is None or project_name not in projects:
            skipped_rel += 1
            continue
        
        pid = projects[project_name]
        rid = make_uuid(f'release-{desc}-{project_name}-{release_date}')
        
        release_lines.append(
            f"  ('{rid}', '{pid}', {fmt_text(desc)}, "
            f"{fmt_date(release_date)}, {fmt_num(amount)}, NULL)"
        )
    
    out.append('-- ============================================================')
    out.append(f'-- 4. DESEMBOLSOS ({len(release_lines)} registros, {skipped_rel} ignorados)')
    out.append('-- ============================================================')
    out.append('')
    if release_lines:
        out.append('INSERT INTO public.funding_releases (id, project_id, description, release_date, amount, notes) VALUES')
        out.append(',\n'.join(release_lines) + ';')
    else:
        out.append('-- Nenhum desembolso encontrado.')
    out.append('')
    
    # ========== 5. EXPENSES ==========
    ws_exp = wb['Tabela outros gastos']
    expense_lines = []
    skipped_exp = 0
    
    for row in ws_exp.iter_rows(min_row=2, max_row=200, min_col=6, max_col=10, values_only=True):
        if row[0] is None or row[0] == 'Nome do gasto':
            continue
        desc = row[0]
        project_name = normalize_project(row[1]) if row[1] else None
        expense_date = row[2]
        amount = row[3]
        
        if project_name is None:
            # Gasto sem projeto - pular com aviso
            skipped_exp += 1
            continue
        
        if project_name not in projects:
            skipped_exp += 1
            continue
        
        pid = projects[project_name]
        eid = make_uuid(f'expense-{desc}-{project_name}-{expense_date}')
        
        expense_lines.append(
            f"  ('{eid}', '{pid}', {fmt_text(desc)}, "
            f"{fmt_date(expense_date)}, {fmt_num(amount)}, NULL, NULL)"
        )
    
    out.append('-- ============================================================')
    out.append(f'-- 5. OUTROS GASTOS ({len(expense_lines)} registros, {skipped_exp} ignorados sem projeto)')
    out.append('-- ============================================================')
    out.append('')
    if expense_lines:
        out.append('INSERT INTO public.expenses (id, project_id, description, expense_date, amount, category, notes) VALUES')
        out.append(',\n'.join(expense_lines) + ';')
    else:
        out.append('-- Nenhum gasto encontrado.')
    out.append('')
    
    # ========== 6. DASHBOARD SETTINGS ==========
    ws_rec = wb['Tabela recursos']
    dashboard_lines = []
    
    for row in ws_rec.iter_rows(min_row=3, max_row=50, min_col=1, max_col=3, values_only=True):
        if row[1] is None:
            continue
        project_name = row[1].strip()
        include = row[0] is True
        
        if project_name not in projects:
            continue
        
        pid = projects[project_name]
        did = make_uuid(f'dashboard-{project_name}')
        
        dashboard_lines.append(
            f"  ('{did}', '{pid}', {'true' if include else 'false'})"
        )
    
    out.append('-- ============================================================')
    out.append(f'-- 6. CONFIGURACAO DASHBOARD ({len(dashboard_lines)} registros)')
    out.append('-- ============================================================')
    out.append('')
    if dashboard_lines:
        out.append('INSERT INTO public.dashboard_settings (id, project_id, include_in_general) VALUES')
        out.append(',\n'.join(dashboard_lines) + ';')
    else:
        out.append('-- Nenhuma configuracao de dashboard encontrada.')
    out.append('')
    
    out.append('COMMIT;')
    out.append('')
    out.append('-- ============================================================')
    out.append('-- VERIFICACAO: Execute apos a importacao')
    out.append('-- ============================================================')
    out.append('-- SELECT count(*) as projetos FROM public.projects;')
    out.append('-- SELECT count(*) as bolsistas FROM public.scholarship_holders;')
    out.append('-- SELECT count(*) as bolsas FROM public.scholarships;')
    out.append('-- SELECT count(*) as desembolsos FROM public.funding_releases;')
    out.append('-- SELECT count(*) as gastos FROM public.expenses;')
    out.append('-- SELECT * FROM public.v_project_summary;')
    out.append('')
    
    # Write output
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    
    # Summary
    print(f'=== SQL GERADO COM SUCESSO ===')
    print(f'Arquivo: {OUTPUT_PATH}')
    print(f'')
    print(f'Resumo:')
    print(f'  Projetos:        {len(proj_lines)}')
    print(f'  Bolsistas:       {len(holder_lines)}')
    print(f'  Bolsas:          {len(scholarship_lines)} ({skipped} sem projeto ignoradas)')
    print(f'  Desembolsos:     {len(release_lines)} ({skipped_rel} ignorados)')
    print(f'  Outros gastos:   {len(expense_lines)} ({skipped_exp} ignorados)')
    print(f'  Dashboard conf:  {len(dashboard_lines)}')
    print(f'')
    print(f'AVISOS:')
    print(f'  - {skipped} bolsas sem projeto foram IGNORADAS (provavelmente bolsas historicas)')
    print(f'  - iCS foi normalizado para ICS')
    print(f'  - Projetos extras (CEMPA, CIAMB, Geral, Manuel) foram adicionados com saldo 0')
    print(f'  - 1 gasto sem projeto ("Diaria Teste") foi IGNORADO')

if __name__ == '__main__':
    main()
