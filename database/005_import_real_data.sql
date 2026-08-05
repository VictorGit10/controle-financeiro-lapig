-- ============================================================
-- IMPORTACAO DE DADOS - Dashboard 2026
-- Gerado automaticamente a partir de DadosDoDashBoardAtual.xlsx
-- ============================================================
--
-- IMPORTANTE: Executar APOS o schema (001_schema.sql).
-- Se ja existirem dados de seed/teste, este script limpa tudo primeiro.
--
-- PRIVACIDADE: os nomes de bolsistas e quaisquer referencias a pessoas
-- foram anonimizados (nomes ficticios) para publicacao do repositorio.
-- Os UUIDs, valores, datas e vinculacoes refletem o estado real do
-- dashboard; apenas a identificacao nominal foi substituida. Para
-- recarregar os nomes reais locais, regere este arquivo a partir da
-- planilha original (database/utils/generate_import_sql.py).
-- ============================================================

BEGIN;

-- Limpar dados existentes (ordem inversa das dependencias)
DELETE FROM public.expenses;
DELETE FROM public.funding_releases;
DELETE FROM public.scholarships;
DELETE FROM public.dashboard_settings;
DELETE FROM public.scholarship_holders;
DELETE FROM public.projects;

-- ============================================================
-- 1. PROJETOS (14 registros)
-- ============================================================

INSERT INTO public.projects (id, name, code, start_date, end_date, initial_balance, yield_amount, report_dates, notes, active) VALUES
  ('0d65f894-8873-50ee-8574-7967c5111362', 'OpenGeoHub', NULL, NULL, '2026-07-01', 52000.00, 40728.77, 'Relatório UFG ao final do projeto', 'Diárias; Passagens aéreas; Material de Consumo; Equipamentos; PJ; Pessoal', true),
  ('010cb048-42d4-5e39-a332-c257cc83a2da', 'MapBiomas', NULL, NULL, '2026-12-31', 290000.00, 49570.54, 'jan/25; abr/25; jul/25; set/25; nov/25', 'Diárias; Passagens aéreas; Material de Consumo; Equipamentos; PJ; Pessoal', true),
  ('efeb529c-c62e-5ab8-943b-d5b90998f8e8', 'Acelen', NULL, NULL, '2027-01-27', 242352.07, 7514.51, NULL, 'Diárias; Passagens aéreas; Material de Consumo; Equipamentos; PJ; Pessoal', true),
  ('6a514258-4635-58b3-b78d-cbc3a5e39f48', 'Global Methane Hub', NULL, NULL, '2027-05-07', 341250.00, 0.00, NULL, NULL, true),
  ('ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 'ICS', NULL, NULL, '2027-08-31', 334205.52, 8000.63, NULL, 'Diárias; Passagens aéreas; Equipamentos; PJ; Pessoal', true),
  ('8cde8941-9dbf-5f89-b5a5-7277fd1e268c', 'REMAP', NULL, NULL, '2026-03-31', 19499.29, 976.62, NULL, 'Pessoal', true),
  ('69d262fb-a974-51b3-86ca-9f097ee0d90c', 'São Martinho', NULL, NULL, '2026-06-30', 3290.76, 0.00, 'Entrega de produto', 'Diárias; Passagens aéreas; Pessoal', true),
  ('792f08ee-e2ff-5154-94e4-3c3a765e28df', 'TNC Cenários', NULL, NULL, '2026-08-30', 34139.91, 4312.27, 'Entrega de produto', 'Diárias; Passagens aéreas; Pessoal', true),
  ('5186e221-3127-5a14-86da-7f9c05fcd8db', 'TNC Syngenta', NULL, NULL, '2026-04-17', 196002.40, 15132.85, NULL, 'Diárias; Passagens aéreas; Material de Consumo; Equipamentos; PJ; Pessoal', true),
  ('b9c82b01-f47b-5471-a43f-2569b78a52df', 'WRI BRASIL', NULL, NULL, '2025-12-31', 111000.00, 0.00, NULL, NULL, true),
  ('b22de46d-0cf6-543a-81c6-8eb21e7e87f7', 'CEMPA', NULL, NULL, NULL, 0.00, 0.00, NULL, 'Projeto importado da Tabela bolsistas (sem dados em Nomenclaturas)', true),
  ('de04ee42-2df4-573e-b800-64d7bc764f34', 'CIAMB', NULL, NULL, NULL, 0.00, 0.00, NULL, 'Projeto importado da Tabela bolsistas (sem dados em Nomenclaturas)', true),
  ('73641f4f-23e1-5af5-b330-c4990aa1bae8', 'Geral', NULL, NULL, NULL, 0.00, 0.00, NULL, 'Projeto importado da Tabela bolsistas (sem dados em Nomenclaturas)', true),
  ('67a784ef-2058-50b2-afd8-a908cc26c8de', 'Manuel', NULL, NULL, NULL, 0.00, 0.00, NULL, 'Projeto importado da Tabela bolsistas (sem dados em Nomenclaturas)', true);

-- ============================================================
-- 2. BOLSISTAS - PESSOAS (94 registros)
-- ============================================================

INSERT INTO public.scholarship_holders (id, full_name, email, active) VALUES
  ('11afde91-533a-5010-ba9b-5e6a6f499d7e', 'Ana Souza Rodrigues', NULL, true),
  ('da9937f3-3fbf-5315-9715-4bfa083e7f36', 'Bruno Fernandes', NULL, true),
  ('760fb283-8147-5b06-a1cf-98e7861fecfb', 'Carla Barbosa', NULL, true),
  ('f1a7828e-026f-5d7a-8b0a-7689ea76e499', 'Diego Correia Lima', NULL, true),
  ('b704d134-3169-5053-8c7e-37b2e3799f2e', 'Elisa Santos', NULL, true),
  ('f5d40acd-a6a3-5009-a3d7-70683a377b73', 'Felipe Lima', NULL, true),
  ('2ba0edcb-81e3-51b2-9a24-3cfd64fbd6f3', 'Gabriela Cardoso Carvalho', NULL, true),
  ('e47da3fc-2c9c-578c-ac13-78c2042a99dd', 'Henrique Castilho', NULL, true),
  ('0d2f3d8f-466b-55f5-af89-8f676c59521b', 'Iara Borges', NULL, true),
  ('7df8d624-abf8-5591-a590-3bed7b02716a', 'João Pereira Rocha', NULL, true),
  ('0f01571c-d8e8-58d1-97c8-897bb5b882b6', 'Karla Martins', NULL, true),
  ('23b8f300-25d7-5d65-9ec0-f3221eb74349', 'Lucas Novaes', NULL, true),
  ('ed013b6c-d2b9-555d-943b-1c7afa19f7c8', 'Mariana Souza Barbosa', NULL, true),
  ('dc0c64e3-b0ea-50c4-bb23-283cc04528cb', 'Nicolas Costa', NULL, true),
  ('b4ef3081-a0d4-5253-b996-3db6a81ef267', 'Olga Carvalho', NULL, true),
  ('ebc2dab5-b2b9-56aa-b058-62f51e627a19', 'Paulo Correia Novaes', NULL, true),
  ('75f379f8-4ca4-5edd-8544-833e7257b664', 'Renata Fonseca', NULL, true),
  ('54e3facb-3c59-5bd5-b6b4-1438565fa118', 'Sandro Oliveira', NULL, true),
  ('44dd9f08-61be-5747-ac2c-7f0afec0181d', 'Tatiana Cardoso Meirelles', NULL, true),
  ('dd4ac723-c791-5b4f-9080-34804c73a137', 'Ulisses Teles', NULL, true),
  ('74379e44-6f8b-5ccd-8eaf-33c86805300e', 'Vanessa Meirelles', NULL, true),
  ('ea884220-4516-5958-a640-8b37be523d3a', 'William Pereira Cunha', NULL, true),
  ('b65e1ed1-5178-5888-bc40-a7dced81845f', 'Yasmin Nascimento', NULL, true),
  ('753f2b0d-74ba-57a4-8dae-f108ef7c9216', 'André Rocha', NULL, true),
  ('6d6f24ab-8900-5898-83d4-ee99e8c93295', 'Beatriz Souza Borges', NULL, true),
  ('3fcad6e3-658d-5b7f-bfb1-ca5263efac5d', 'Caio Garcia', NULL, true),
  ('1906dea7-2c28-5905-b192-c2a3da8cd48f', 'Daniela Rodrigues', NULL, true),
  ('e68d96eb-c02d-5df7-af6d-51aebf6b045e', 'Eduardo Correia Oliveira', NULL, true),
  ('157a65a7-5b78-52a4-a75e-861e32a21f59', 'Fernanda Assunção', NULL, true),
  ('c8038b4d-6586-591c-b738-97ddfa39ae3a', 'Gustavo Cunha', NULL, true),
  ('ffbb1aad-9bc6-5e6b-9650-ad4e3d70c6d7', 'Helena Cardoso Rodrigues', NULL, true),
  ('490b718b-40de-5448-9099-99ebbf8a06b6', 'Igor Fernandes', NULL, true),
  ('3893bcce-7a7c-5278-9c34-fb91b70bbd9b', 'Juliana Barbosa', NULL, true),
  ('0800d8b8-c672-5be8-a7c0-61f10214f628', 'Leandro Pereira Lima', NULL, true),
  ('d0224fce-580a-581e-85c4-61bc24e2e3bd', 'Manuela Santos', NULL, true),
  ('6f71de6f-35c2-59e7-8bd8-dc9fbb59e270', 'Nelson Lima', NULL, true),
  ('a600b3f0-69f2-5710-ac7a-c571ba7dea97', 'Patrícia Souza Carvalho', NULL, true),
  ('a3d6bbf1-ed0f-599e-ac74-cf6618dc09fd', 'Rafael Castilho', NULL, true),
  ('7f5220f2-3d34-58ab-aeae-b51bf1985158', 'Sofia Borges', NULL, true),
  ('163c561c-a06a-5d76-b8db-fbae0c303cd9', 'Tiago Correia Rocha', NULL, true),
  ('b877c099-52e6-5485-b5e8-4155cda86410', 'Ursula Martins', NULL, true),
  ('5b55574d-2df9-5ae5-b115-edcfb202e440', 'Vinícius Novaes', NULL, true),
  ('1ac9ca39-2269-561a-b635-9bbf4446f42f', 'Wesley Cardoso Barbosa', NULL, true),
  ('5edb6884-d197-51a6-a1d0-ff759f245d2c', 'Yara Costa', NULL, true),
  ('9efa19cd-7976-5e64-808d-e7766eea4904', 'Adriano Carvalho', NULL, true),
  ('e18deb01-b301-5518-bcbc-d8fba30b63d4', 'Bruna Pereira Novaes', NULL, true),
  ('ad3df9e2-45cb-5798-b3a8-a7eb463f3877', 'Cláudio Fonseca', NULL, true),
  ('99c64c29-208b-5153-a312-d03bae692088', 'Denise Oliveira', NULL, true),
  ('8b53fa39-7257-5fcb-a087-b1135c6db1b3', 'Evandro Souza Meirelles', NULL, true),
  ('85fd7bdd-9734-5415-bbce-f3ea0dfa4d0e', 'Fabiana Teles', NULL, true),
  ('e24022e7-0101-5bd8-8868-c482f29246e7', 'Ana Meirelles', NULL, true),
  ('ca89a637-0d6d-52ed-a430-e65ecd71dcb2', 'Bruno Correia Cunha', NULL, true),
  ('c7507ebb-92c7-5f61-888c-b90df9f5fa52', 'Carla Nascimento', NULL, true),
  ('6e7f6b06-c2a2-5db6-b039-2d8bda6b2ba2', 'Diego Rocha', NULL, true),
  ('70072d0c-3d89-56fc-9d9b-127c0e044a56', 'Elisa Cardoso Borges', NULL, true),
  ('8fa666be-1591-5dcc-b670-6a375ce1525e', 'Felipe Garcia', NULL, true),
  ('74cbec26-b1a0-52f6-810c-729ffa247964', 'Gabriela Rodrigues', NULL, true),
  ('82d53bae-7720-531d-aaed-19f48d34658a', 'Henrique Pereira Oliveira', NULL, true),
  ('217005e4-2dcf-56da-b886-4172a96bee09', 'Iara Assunção', NULL, true),
  ('1f8c9662-4148-5ce9-99d0-92575f2b9aaa', 'João Cunha', NULL, true),
  ('0b3980c0-f269-51e8-bb25-4b742e38a790', 'Karla Souza Rodrigues', NULL, true),
  ('9b004086-b4be-59c9-baf3-8cb8c1ac2477', 'Lucas Fernandes', NULL, true),
  ('86f971d0-4de4-5755-8d2a-8cb23ba8f54b', 'Mariana Barbosa', NULL, true),
  ('38278b19-9cfd-592e-a9d6-db5acd1bd3a2', 'Nicolas Correia Lima', NULL, true),
  ('33bae5f9-413f-52fe-828d-9741383702ab', 'Olga Santos', NULL, true),
  ('465d0dcf-463f-55ea-a307-cc72945b7491', 'Paulo Lima', NULL, true),
  ('42e765f1-e787-5ce0-9fc2-86e19e0af5e6', 'Renata Cardoso Carvalho', NULL, true),
  ('6707e467-0198-5dc5-b415-c35c47b3296c', 'Sandro Castilho', NULL, true),
  ('1503e573-aaf2-5138-8601-762e00423dd6', 'Tatiana Borges', NULL, true),
  ('6d61dddf-87b2-5841-b98a-862117a2bacf', 'Ulisses Pereira Rocha', NULL, true),
  ('ff7be065-606e-57f6-b5b6-55a0b857d437', 'Vanessa Martins', NULL, true),
  ('a867a852-f1f2-51b3-bf89-7861bb13198a', 'William Novaes', NULL, true),
  ('f0d75d1d-677e-5505-9b52-3f0d71edec11', 'Yasmin Souza Barbosa', NULL, true),
  ('dfc8127b-3a8a-53ea-b6b6-748fcbb9b327', 'André Costa', NULL, true),
  ('815b8476-aa11-544a-9b6a-4503a94d06bb', 'Beatriz Carvalho', NULL, true),
  ('c8a6c432-644a-55a5-b16d-a42be19a180f', 'Caio Correia Novaes', NULL, true),
  ('df76e51d-ec58-5cf4-aa3d-4827d09fc413', 'Daniela Fonseca', NULL, true),
  ('fd3453f0-e7fb-5288-9210-2efcd44ddac6', 'Eduardo Oliveira', NULL, true),
  ('8886f832-4dd9-595e-87c2-ab916b0e124a', 'Fernanda Cardoso Meirelles', NULL, true),
  ('5c86f64a-a190-5372-8b03-a85f55493115', 'Gustavo Teles', NULL, true),
  ('8bbc8c06-654d-5124-bc53-9ca851bc756a', 'Helena Meirelles', NULL, true),
  ('99846b31-22c5-5276-beda-221c584eb71c', 'Igor Pereira Cunha', NULL, true),
  ('3fc17e90-806b-5e89-b2a1-c72637fd9f41', 'Juliana Nascimento', NULL, true),
  ('fad48db1-11be-55a5-b2e9-8d868e5be1a6', 'Leandro Rocha', NULL, true),
  ('88047e2e-cb0d-5f59-9db7-5b9b07aa454b', 'Manuela Souza Borges', NULL, true),
  ('2437c2df-6b1a-596b-8225-ba9a1ccb0320', 'Nelson Garcia', NULL, true),
  ('45ce950f-6311-528e-97bf-c1c0a4621585', 'Patrícia Rodrigues', NULL, true),
  ('ee954f40-93f3-5278-ac77-d3b35a88166e', 'Rafael Correia Oliveira', NULL, true),
  ('ca4e7483-f085-5e65-9853-08b9a1610ba4', 'Sofia Assunção', NULL, true),
  ('5bace70a-f6d5-5dca-9b8c-9e670527a83e', 'Tiago Cunha', NULL, true),
  ('8859677e-5a74-5c59-a514-9e8494b75f49', 'Ursula Cardoso Rodrigues', NULL, true),
  ('746bb0c2-b3c4-5515-90c2-47aa24b1645f', 'Vinícius Fernandes', NULL, true),
  ('5dc2c3d6-3f3a-56e1-9939-89bd1ea5774a', 'Wesley Barbosa', NULL, true),
  ('ae89960f-e98d-51f7-8886-29192cc9673a', 'Yara Pereira Lima', NULL, true);

-- ============================================================
-- 3. BOLSAS - VINCULACOES (116 registros, 24 ignorados sem projeto)
-- ============================================================

INSERT INTO public.scholarships (id, holder_id, project_id, amount, start_date, end_date, status, notes) VALUES
  ('0cd329bc-e197-5878-b011-fc67b72878ca', '11afde91-533a-5010-ba9b-5e6a6f499d7e', 'efeb529c-c62e-5ab8-943b-d5b90998f8e8', 14000.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('72f232eb-eb99-582f-a90d-97e33c321340', 'da9937f3-3fbf-5315-9715-4bfa083e7f36', 'efeb529c-c62e-5ab8-943b-d5b90998f8e8', 2300.00, '2026-01-01', '2026-03-31', 'ended', NULL),
  ('0f9b6829-1f52-568c-89fe-81bc5dd432b5', 'da9937f3-3fbf-5315-9715-4bfa083e7f36', 'efeb529c-c62e-5ab8-943b-d5b90998f8e8', 3500.00, '2026-04-27', '2026-12-31', 'active', NULL),
  ('2f3b4176-7407-59db-95c2-56ffbde1ce91', '760fb283-8147-5b06-a1cf-98e7861fecfb', 'b22de46d-0cf6-543a-81c6-8eb21e7e87f7', 2000.00, '2024-08-01', '2025-09-30', 'ended', NULL),
  ('57d8b5dd-cab7-5801-9c09-035f7d245ae0', 'f1a7828e-026f-5d7a-8b0a-7689ea76e499', 'de04ee42-2df4-573e-b800-64d7bc764f34', 2100.00, '2025-03-01', '2027-02-28', 'active', NULL),
  ('cfac624f-ee68-597a-af6e-699275509d5b', 'b704d134-3169-5053-8c7e-37b2e3799f2e', 'de04ee42-2df4-573e-b800-64d7bc764f34', 2100.00, '2025-03-01', '2027-02-28', 'active', NULL),
  ('93097c6d-10c7-5291-b439-3a95bec498ec', '760fb283-8147-5b06-a1cf-98e7861fecfb', 'de04ee42-2df4-573e-b800-64d7bc764f34', 2100.00, '2025-03-01', '2027-02-28', 'active', NULL),
  ('3a43531c-5aa7-5204-ba20-037a5493ad05', 'f5d40acd-a6a3-5009-a3d7-70683a377b73', '73641f4f-23e1-5af5-b330-c4990aa1bae8', 2500.00, '2025-12-01', '2025-12-31', 'ended', NULL),
  ('6e456b0e-ec1d-56c5-a829-d926fc2ec3a2', '2ba0edcb-81e3-51b2-9a24-3cfd64fbd6f3', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 6000.00, '2025-11-01', '2027-09-30', 'active', NULL),
  ('e8c70134-2064-5efd-8ad8-3e3c0a174f6c', 'e47da3fc-2c9c-578c-ac13-78c2042a99dd', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 12000.00, '2025-11-01', '2027-09-30', 'active', NULL),
  ('0c41604d-fc35-5f1b-ade8-aacb13db02c9', '0d2f3d8f-466b-55f5-af89-8f676c59521b', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 5000.00, '2025-11-01', '2027-09-30', 'active', NULL),
  ('56a4648e-c6c2-5e4a-8063-80cda2affe90', '7df8d624-abf8-5591-a590-3bed7b02716a', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 6000.00, '2025-11-01', '2026-02-28', 'ended', NULL),
  ('315098dd-328c-5ef2-a325-46e9e4713d78', '760fb283-8147-5b06-a1cf-98e7861fecfb', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 2500.00, '2025-11-01', '2027-09-30', 'active', NULL),
  ('fbe34931-c42e-5305-9c34-820544fe2398', '7df8d624-abf8-5591-a590-3bed7b02716a', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 12000.00, '2026-03-01', '2027-09-30', 'active', NULL),
  ('a32688ad-9d7e-5092-9fb4-2876690765aa', '760fb283-8147-5b06-a1cf-98e7861fecfb', '67a784ef-2058-50b2-afd8-a908cc26c8de', 1500.00, '2025-04-01', '2026-03-31', 'ended', NULL),
  ('5c1de78d-ad03-5501-8339-e07c325ca7c3', '0f01571c-d8e8-58d1-97c8-897bb5b882b6', '010cb048-42d4-5e39-a332-c257cc83a2da', 7635.36, '2026-01-01', '2026-12-31', 'active', NULL),
  ('7de5915e-77a4-556b-a091-14830084b241', '23b8f300-25d7-5d65-9ec0-f3221eb74349', '010cb048-42d4-5e39-a332-c257cc83a2da', 7500.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('4b38328a-d5e2-5771-952d-239248cd7742', 'ed013b6c-d2b9-555d-943b-1c7afa19f7c8', '010cb048-42d4-5e39-a332-c257cc83a2da', 1800.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('f4b3de4f-f312-5513-8234-ce87b92e7b11', 'dc0c64e3-b0ea-50c4-bb23-283cc04528cb', '010cb048-42d4-5e39-a332-c257cc83a2da', 1800.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('e61f2534-68e8-5750-a05c-814d91d7f958', 'b4ef3081-a0d4-5253-b996-3db6a81ef267', '010cb048-42d4-5e39-a332-c257cc83a2da', 2000.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('59446d0b-abe1-5b88-a92b-9e052f71ac47', '2ba0edcb-81e3-51b2-9a24-3cfd64fbd6f3', '0d65f894-8873-50ee-8574-7967c5111362', 6000.00, '2025-08-01', '2026-07-30', 'active', NULL),
  ('43ebb1a1-4673-57a2-9bcb-623597848a83', 'da9937f3-3fbf-5315-9715-4bfa083e7f36', '8cde8941-9dbf-5f89-b5a5-7277fd1e268c', 1200.00, '2025-10-01', '2026-03-31', 'ended', NULL),
  ('e5302b65-4a44-5ea1-8a50-4a943e817533', 'dc0c64e3-b0ea-50c4-bb23-283cc04528cb', '8cde8941-9dbf-5f89-b5a5-7277fd1e268c', 1200.00, '2025-10-01', '2026-03-31', 'ended', NULL),
  ('0e846f9f-a1b5-52f1-ade8-90e7b0954fab', 'ebc2dab5-b2b9-56aa-b058-62f51e627a19', '8cde8941-9dbf-5f89-b5a5-7277fd1e268c', 1200.00, '2025-10-01', '2026-03-31', 'ended', NULL),
  ('adc5e95f-eb3f-540b-b372-f1482971fd8a', 'ed013b6c-d2b9-555d-943b-1c7afa19f7c8', '8cde8941-9dbf-5f89-b5a5-7277fd1e268c', 1500.00, '2025-10-01', '2026-03-31', 'ended', NULL),
  ('708f84e4-eb32-573a-9cd3-7cd424df7a29', '75f379f8-4ca4-5edd-8544-833e7257b664', '69d262fb-a974-51b3-86ca-9f097ee0d90c', 2500.00, '2025-04-01', '2025-12-31', 'ended', NULL),
  ('7320aca9-1e31-5084-900e-2cbb8a23fbca', '11afde91-533a-5010-ba9b-5e6a6f499d7e', '69d262fb-a974-51b3-86ca-9f097ee0d90c', 7000.00, '2025-04-01', '2025-12-31', 'ended', NULL),
  ('c087cb2c-2136-5942-96a1-b3991743f516', '54e3facb-3c59-5bd5-b6b4-1438565fa118', '69d262fb-a974-51b3-86ca-9f097ee0d90c', 1500.00, '2025-04-01', '2025-12-31', 'ended', NULL),
  ('7692fddc-6ae1-5ea6-a3ae-30120e752056', '44dd9f08-61be-5747-ac2c-7f0afec0181d', '69d262fb-a974-51b3-86ca-9f097ee0d90c', 2500.00, '2025-04-01', '2025-12-31', 'ended', NULL),
  ('d387b045-2be5-5e72-94ed-eda97cd75978', 'dd4ac723-c791-5b4f-9080-34804c73a137', '69d262fb-a974-51b3-86ca-9f097ee0d90c', 2500.00, '2025-04-01', '2025-12-31', 'ended', NULL),
  ('30d53399-0b2c-5cd6-96e4-3337d56a85a9', '74379e44-6f8b-5ccd-8eaf-33c86805300e', '792f08ee-e2ff-5154-94e4-3c3a765e28df', 12000.00, '2025-05-01', '2026-01-31', 'ended', NULL),
  ('46e2b52b-c75b-5f79-ba6b-6825290651ad', 'f1a7828e-026f-5d7a-8b0a-7689ea76e499', '792f08ee-e2ff-5154-94e4-3c3a765e28df', 975.00, '2025-05-01', '2026-02-28', 'ended', NULL),
  ('bfaf6182-2767-5dad-8dfc-98cb34949917', 'b704d134-3169-5053-8c7e-37b2e3799f2e', '792f08ee-e2ff-5154-94e4-3c3a765e28df', 975.00, '2025-05-01', '2026-02-28', 'ended', NULL),
  ('6de272e8-0341-501e-b521-a0ca79a5da1b', 'ea884220-4516-5958-a640-8b37be523d3a', '792f08ee-e2ff-5154-94e4-3c3a765e28df', 12000.00, '2025-05-01', '2026-02-28', 'ended', NULL),
  ('0e2b8ba8-947c-50eb-b7ca-879adcff0e4d', 'b65e1ed1-5178-5888-bc40-a7dced81845f', '5186e221-3127-5a14-86da-7f9c05fcd8db', 1100.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('f407f0c9-7b24-5335-a2a4-f1206255c0d5', 'b704d134-3169-5053-8c7e-37b2e3799f2e', '5186e221-3127-5a14-86da-7f9c05fcd8db', 975.00, '2026-03-01', '2026-12-31', 'active', NULL),
  ('5f9333fd-baeb-5230-8020-cbe70f447468', 'f1a7828e-026f-5d7a-8b0a-7689ea76e499', '5186e221-3127-5a14-86da-7f9c05fcd8db', 975.00, '2026-03-01', '2026-12-31', 'active', NULL),
  ('5f254433-bf05-575f-a101-de6d40383657', '753f2b0d-74ba-57a4-8dae-f108ef7c9216', '5186e221-3127-5a14-86da-7f9c05fcd8db', 8000.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('35d50b84-a6ba-5f75-a381-72f05ba89e34', '54e3facb-3c59-5bd5-b6b4-1438565fa118', '5186e221-3127-5a14-86da-7f9c05fcd8db', 3500.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('538295bf-ce84-5097-8361-9d23ca1110d6', '75f379f8-4ca4-5edd-8544-833e7257b664', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 3500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('8ec9cea5-765f-5c35-a80b-c2f6e0b98349', '3893bcce-7a7c-5278-9c34-fb91b70bbd9b', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 2500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('8fb55b7d-1e2d-546b-8598-a7816b2748a2', 'ebc2dab5-b2b9-56aa-b058-62f51e627a19', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 1800.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('23fc9369-a637-5cc4-b8f8-878c00994b15', '2ba0edcb-81e3-51b2-9a24-3cfd64fbd6f3', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 6000.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('7b72d8e3-110d-5842-a2f2-68f2e1855099', 'b4ef3081-a0d4-5253-b996-3db6a81ef267', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 2000.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('40c96a32-5368-5db6-87d2-6bb2ff580885', 'e68d96eb-c02d-5df7-af6d-51aebf6b045e', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 5000.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('47c9c3f2-1f61-59d1-bb4f-49b6486d1d99', '0800d8b8-c672-5be8-a7c0-61f10214f628', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 2500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('3025979a-bda0-5454-a0b4-b2b48e46b33d', '157a65a7-5b78-52a4-a75e-861e32a21f59', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 2500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('79336252-80b2-5cea-9276-a83404da299f', 'd0224fce-580a-581e-85c4-61bc24e2e3bd', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 2500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('33041c3e-a605-59e2-8ece-5ffc6f171928', '760fb283-8147-5b06-a1cf-98e7861fecfb', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 900.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('94b8dfdf-9fef-51af-b92b-60ff635cf743', 'ffbb1aad-9bc6-5e6b-9650-ad4e3d70c6d7', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 12500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('ba4bcdf0-b869-59fd-bdb3-48f208973c33', '490b718b-40de-5448-9099-99ebbf8a06b6', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 4000.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('22302fcf-94fd-527c-84bf-0d5f72fa24ec', '6d6f24ab-8900-5898-83d4-ee99e8c93295', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 2500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('641e7729-3854-5319-b96a-c03f013b8fca', '6f71de6f-35c2-59e7-8bd8-dc9fbb59e270', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 5200.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('fb4d00d4-63da-5ab5-8335-97cd2853c77f', '1906dea7-2c28-5905-b192-c2a3da8cd48f', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 2500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('50235d36-15d8-5abc-81b1-01ca7ccffa33', 'c8038b4d-6586-591c-b738-97ddfa39ae3a', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 4500.00, '2026-01-01', '2027-04-30', 'active', NULL),
  ('904d16c1-0d76-5814-9a6d-ba94297296e1', '6f71de6f-35c2-59e7-8bd8-dc9fbb59e270', 'efeb529c-c62e-5ab8-943b-d5b90998f8e8', 5200.00, '2025-11-01', '2026-01-31', 'ended', NULL),
  ('b9350157-29cc-5e50-962d-5dae6235dafd', 'a600b3f0-69f2-5710-ac7a-c571ba7dea97', '010cb048-42d4-5e39-a332-c257cc83a2da', 8500.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('7d8e2280-ee03-5ab5-8442-3e732f70438f', 'd0224fce-580a-581e-85c4-61bc24e2e3bd', '010cb048-42d4-5e39-a332-c257cc83a2da', 1400.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('9743f4d2-1c3f-5da4-8d5b-66fa6080a5bb', 'a3d6bbf1-ed0f-599e-ac74-cf6618dc09fd', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('da52a0ab-3d31-5675-864f-e047354693a8', '7f5220f2-3d34-58ab-aeae-b51bf1985158', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('a4eda9ce-7467-5c6e-beaa-868bd3d55a11', '163c561c-a06a-5d76-b8db-fbae0c303cd9', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('16193520-59bb-580c-9572-836d7a165429', 'b877c099-52e6-5485-b5e8-4155cda86410', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('ee4d3281-e800-5554-ac33-0827c2a5cf5e', '5b55574d-2df9-5ae5-b115-edcfb202e440', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('70f5c763-7e40-59d4-92df-1aa20de02812', '1ac9ca39-2269-561a-b635-9bbf4446f42f', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('6b44ef16-8b3e-54a9-bf68-8707e2dda8dc', '5edb6884-d197-51a6-a1d0-ff759f245d2c', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('1f65bb7d-62e2-5e94-aa40-3151ca1b4ac9', '9efa19cd-7976-5e64-808d-e7766eea4904', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('85e47ba7-4372-593d-95ad-f08e7c8bcf4e', 'e18deb01-b301-5518-bcbc-d8fba30b63d4', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('dc07b0e3-4fbc-594f-8358-4d0c8978e897', 'ad3df9e2-45cb-5798-b3a8-a7eb463f3877', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('80366736-34ed-5344-be6d-0695e104475c', '99c64c29-208b-5153-a312-d03bae692088', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('c56ee24e-abaf-52f2-9c28-448a2c104221', '8b53fa39-7257-5fcb-a087-b1135c6db1b3', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('035219dd-bc5c-5d46-906b-33fc38ad6818', '85fd7bdd-9734-5415-bbce-f3ea0dfa4d0e', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('1f8b01dc-64be-5e74-8d30-e987ad2c25ba', 'e24022e7-0101-5bd8-8868-c482f29246e7', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('e701a41e-2223-5589-b513-1ded6ff3f147', 'ca89a637-0d6d-52ed-a430-e65ecd71dcb2', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('3f357bef-2f90-5c4c-8fe4-bf39c1670ffc', 'c7507ebb-92c7-5f61-888c-b90df9f5fa52', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('836cba4d-0029-5f13-a35c-bd3b56c4b6c0', '6e7f6b06-c2a2-5db6-b039-2d8bda6b2ba2', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('fb230605-2b86-5ec7-b876-1ab53c946ecf', '70072d0c-3d89-56fc-9d9b-127c0e044a56', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('3b6a68cc-f541-533c-b6b4-a4f0e5223a1a', '8fa666be-1591-5dcc-b670-6a375ce1525e', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('be8d7fc9-4299-5e27-accd-83494ccb3ddf', '74cbec26-b1a0-52f6-810c-729ffa247964', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('3098b4e2-ff8b-5542-8d34-9d8d8250a8cf', '82d53bae-7720-531d-aaed-19f48d34658a', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('088194a5-0405-51b8-b495-c4cc6eb8bf55', '217005e4-2dcf-56da-b886-4172a96bee09', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('52932cef-bd9e-5c0a-a072-c1d4446d8487', '1f8c9662-4148-5ce9-99d0-92575f2b9aaa', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('c51c067d-5e0d-5341-a4bc-73a7b677d0d9', '0b3980c0-f269-51e8-bb25-4b742e38a790', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('314f6d47-7a16-5896-b254-4812f213f193', '9b004086-b4be-59c9-baf3-8cb8c1ac2477', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('6a16dd7a-c178-5a64-aeb8-84e3c26d105e', '86f971d0-4de4-5755-8d2a-8cb23ba8f54b', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('8af6ee40-99fc-5740-b5c9-84a695e8f9b4', '38278b19-9cfd-592e-a9d6-db5acd1bd3a2', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('98b7acbc-c015-57fb-ae00-429cdb1a3797', '33bae5f9-413f-52fe-828d-9741383702ab', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('4e0a72ef-8362-55d9-a5a6-348c692fbce2', '465d0dcf-463f-55ea-a307-cc72945b7491', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('9383e19c-5a94-5f75-850a-2832982ae91f', '42e765f1-e787-5ce0-9fc2-86e19e0af5e6', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('23271495-d802-5e43-b799-abdb06220c20', '6707e467-0198-5dc5-b415-c35c47b3296c', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('73f96484-5971-5857-a76c-9bc08c3b2dc5', '1503e573-aaf2-5138-8601-762e00423dd6', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('ab2b4b8e-4dd1-5c3e-a2bd-e349e138db5b', '6d61dddf-87b2-5841-b98a-862117a2bacf', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('42e32820-cb56-584d-b1af-92bd06d26c4a', 'ff7be065-606e-57f6-b5b6-55a0b857d437', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('5bed5090-53c9-5bc8-ab50-0c14bea9cb54', 'a867a852-f1f2-51b3-bf89-7861bb13198a', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('6310d31c-b532-5288-ba83-9c3d884f1501', 'f0d75d1d-677e-5505-9b52-3f0d71edec11', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('6de21371-1dd4-54f4-919c-fd5b3e9b1fb2', 'dfc8127b-3a8a-53ea-b6b6-748fcbb9b327', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('0b5f6f51-b91e-5c42-8f59-a30b9e2b2aea', '815b8476-aa11-544a-9b6a-4503a94d06bb', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('3b14bb3f-d076-5e46-94f3-b73cdcfc12f1', 'c8a6c432-644a-55a5-b16d-a42be19a180f', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('b257d39d-82f2-5643-973e-98fef7dcbb27', 'df76e51d-ec58-5cf4-aa3d-4827d09fc413', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('bb8860fa-0dab-5b9b-83e5-52a36e72dd06', 'fd3453f0-e7fb-5288-9210-2efcd44ddac6', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('581b210e-7c3c-5b66-9a66-327ddffc9f77', '8886f832-4dd9-595e-87c2-ab916b0e124a', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('0d447891-b995-547b-ad7f-1471a3def0ca', '5c86f64a-a190-5372-8b03-a85f55493115', '010cb048-42d4-5e39-a332-c257cc83a2da', 900.00, '2026-01-01', '2026-06-30', 'active', NULL),
  ('31b17355-793b-5389-a5e2-e6be0974a4c8', '8bbc8c06-654d-5124-bc53-9ca851bc756a', '010cb048-42d4-5e39-a332-c257cc83a2da', 7500.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('f20cd6a9-76ab-56ce-b089-95c2e71e928f', 'b4ef3081-a0d4-5253-b996-3db6a81ef267', '010cb048-42d4-5e39-a332-c257cc83a2da', 2000.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('519a92cf-412f-52d4-af5c-33e4949d9dbb', '99846b31-22c5-5276-beda-221c584eb71c', '010cb048-42d4-5e39-a332-c257cc83a2da', 1800.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('efa91094-d22a-5ece-93b7-3205a4fa28f1', '3fc17e90-806b-5e89-b2a1-c72637fd9f41', '010cb048-42d4-5e39-a332-c257cc83a2da', 1100.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('9efea77f-45f8-5650-a67d-22c879aa6440', 'fad48db1-11be-55a5-b2e9-8d868e5be1a6', '010cb048-42d4-5e39-a332-c257cc83a2da', 1100.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('9782efa5-ed1a-58c5-b1ac-13f9933ebde3', '88047e2e-cb0d-5f59-9db7-5b9b07aa454b', '010cb048-42d4-5e39-a332-c257cc83a2da', 1050.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('0a12c08f-a1a0-579e-95df-0c02cf515faa', '2437c2df-6b1a-596b-8225-ba9a1ccb0320', '010cb048-42d4-5e39-a332-c257cc83a2da', 700.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('230a791c-7c56-552e-9ffc-68bb691441a5', '45ce950f-6311-528e-97bf-c1c0a4621585', '010cb048-42d4-5e39-a332-c257cc83a2da', 3900.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('178afce5-d7f3-5fa0-9285-e149bc1163d8', 'ee954f40-93f3-5278-ac77-d3b35a88166e', '010cb048-42d4-5e39-a332-c257cc83a2da', 700.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('19ea179b-4f9f-543b-b1ac-852ed427dbea', 'ca4e7483-f085-5e65-9853-08b9a1610ba4', '010cb048-42d4-5e39-a332-c257cc83a2da', 700.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('d64fa13b-8a20-5c92-9ebb-e29298583e65', '5bace70a-f6d5-5dca-9b8c-9e670527a83e', '010cb048-42d4-5e39-a332-c257cc83a2da', 700.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('ce8e4cfb-19e9-51af-abd4-0177ed9b3d65', '8859677e-5a74-5c59-a514-9e8494b75f49', '010cb048-42d4-5e39-a332-c257cc83a2da', 700.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('9d96a60e-03e3-5084-b3c5-4ebbb98fcd67', '746bb0c2-b3c4-5515-90c2-47aa24b1645f', '010cb048-42d4-5e39-a332-c257cc83a2da', 700.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('bcf5b26d-79c3-554e-8543-0ddd7b0dd1ee', '5dc2c3d6-3f3a-56e1-9939-89bd1ea5774a', '010cb048-42d4-5e39-a332-c257cc83a2da', 700.00, '2026-01-01', '2026-12-31', 'active', NULL),
  ('82b6d139-2205-5fec-876e-3dc74c61e9a2', 'ae89960f-e98d-51f7-8886-29192cc9673a', '010cb048-42d4-5e39-a332-c257cc83a2da', 700.00, '2026-01-01', '2026-12-31', 'active', NULL);

-- ============================================================
-- 4. DESEMBOLSOS (12 registros, 0 ignorados)
-- ============================================================

INSERT INTO public.funding_releases (id, project_id, description, release_date, amount, notes) VALUES
  ('8569608c-c671-5ccb-ad9e-1ac08101ef76', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', '1 desembolso', '2025-11-03', 475000.00, NULL),
  ('330a2db4-b78a-5660-934d-69c11a8ab490', 'efeb529c-c62e-5ab8-943b-d5b90998f8e8', 'Acelen 4', '2026-02-01', 164241.00, NULL),
  ('39ef9f1a-d515-55fa-a4e7-519b6985ad9a', 'efeb529c-c62e-5ab8-943b-d5b90998f8e8', 'Acelen 5', '2026-07-01', 54747.00, NULL),
  ('a61cedc7-d993-5eee-837e-990f3bd4e826', 'efeb529c-c62e-5ab8-943b-d5b90998f8e8', 'Acelen 6', '2026-09-01', 82120.50, NULL),
  ('1211d4f9-4f72-5f48-b739-a5786b2bacea', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 'WRI 1', '2026-04-01', 0, NULL),
  ('06482a80-ef92-56d0-8788-5e8cd39e22aa', '6a514258-4635-58b3-b78d-cbc3a5e39f48', 'WRI 2', '2026-09-01', 0, NULL),
  ('e72dd7c6-fe35-5893-8a9c-aca1a6de5dbe', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 'ICS 2', '2026-05-01', 475000.00, NULL),
  ('be60a296-efb5-58f7-bfd1-c5cd1e3653c4', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 'ICS 3', '2026-11-01', 475000.00, NULL),
  ('f395bb52-f1f0-5dcf-8350-5dc19be3a3fe', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', 'ICS 4', '2027-05-01', 475000.00, NULL),
  ('8e33c9f2-4ae7-57fa-9622-7d3fcf620077', '010cb048-42d4-5e39-a332-c257cc83a2da', 'MapBiomas 2', '2026-04-01', 470000.00, NULL),
  ('ca1abe15-8689-5e70-89fe-97211090b6e2', '010cb048-42d4-5e39-a332-c257cc83a2da', 'MapBiomas 3', '2026-08-01', 500000.00, NULL),
  ('c37ea942-6908-5b48-9a3f-e1e3eabd7df6', '010cb048-42d4-5e39-a332-c257cc83a2da', 'MapBiomas 4', '2026-12-01', 40000.00, NULL);

-- ============================================================
-- 5. OUTROS GASTOS (3 registros, 1 ignorados sem projeto)
-- ============================================================

INSERT INTO public.expenses (id, project_id, description, expense_date, amount, category, notes) VALUES
  ('d71acd06-d91b-5a38-8712-0c916ff6b86b', '010cb048-42d4-5e39-a332-c257cc83a2da', 'Camisas', '2025-12-01', 4600.00, NULL, NULL),
  ('6e5bf9a9-671b-5fce-8fc0-945469191b13', '010cb048-42d4-5e39-a332-c257cc83a2da', 'Despesa COP', '2025-12-01', 8000.00, NULL, NULL),
  ('19c4e9e9-ed7f-5d7c-a972-f664b809ed81', '010cb048-42d4-5e39-a332-c257cc83a2da', 'bottons', '2025-12-01', 1000.00, NULL, NULL);

-- ============================================================
-- 6. CONFIGURACAO DASHBOARD (10 registros)
-- ============================================================

INSERT INTO public.dashboard_settings (id, project_id, include_in_general) VALUES
  ('eaff0595-792e-5a80-b82c-60bdb35d3e3f', '0d65f894-8873-50ee-8574-7967c5111362', true),
  ('465698af-facd-5564-9b92-d7b67d11c308', '010cb048-42d4-5e39-a332-c257cc83a2da', true),
  ('1760336a-e0a0-5e91-92b7-db88a7f86450', 'efeb529c-c62e-5ab8-943b-d5b90998f8e8', true),
  ('fff3b89c-fd69-5c4e-8d49-742adf83bebe', '6a514258-4635-58b3-b78d-cbc3a5e39f48', true),
  ('38fdca45-5ed1-5efb-a292-cb4a1211c0cd', 'ac181ac4-a4ba-5199-b9f3-0f3ea3c0d42e', false),
  ('22c6897b-7d60-5171-a79f-e5d0dfa40665', '8cde8941-9dbf-5f89-b5a5-7277fd1e268c', false),
  ('fec48419-aa0e-58a0-a01b-247eda2a99b7', '69d262fb-a974-51b3-86ca-9f097ee0d90c', false),
  ('ba5c450c-fbf0-5997-8064-80a75e2a1488', '792f08ee-e2ff-5154-94e4-3c3a765e28df', false),
  ('aecec34a-e103-54b8-886b-321881f8ca04', '5186e221-3127-5a14-86da-7f9c05fcd8db', false),
  ('6c56ad21-eb7b-5079-ad6f-70d9f5233186', 'b9c82b01-f47b-5471-a43f-2569b78a52df', false);

COMMIT;

-- ============================================================
-- VERIFICACAO: Execute apos a importacao
-- ============================================================
-- SELECT count(*) as projetos FROM public.projects;
-- SELECT count(*) as bolsistas FROM public.scholarship_holders;
-- SELECT count(*) as bolsas FROM public.scholarships;
-- SELECT count(*) as desembolsos FROM public.funding_releases;
-- SELECT count(*) as gastos FROM public.expenses;
-- SELECT * FROM public.v_project_summary;
