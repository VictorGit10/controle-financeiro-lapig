/* ============================================================
   funape-contas.js
   Tabela "Reduzido" → código completo do plano de contas da FUNAPE
   (grupo 7, contas-folha).

   Por que existe: o balancete às vezes sai com a coluna "Conta"
   CORTADA no próprio PDF — o layout de 2026-09 corta em 14
   caracteres ("7.1.3.05.01.00042" vira "7.1.3.05.01.00"), e alguns
   PDFs de 2024–2025 cortavam em 13 ou 16. O código "Reduzido" (2ª
   coluna) não é cortado e é o mesmo em todos os centros de custo, então
   identifica a conta. Sem o código completo, o longest-prefix-match do
   conta_rubrica_map jogaria passagens, DAO e as redutoras "( - )" de
   7.1.3.05 em `b` — número plausível e errado.

   De onde vem: linhas com código COMPLETO (5 dígitos no último nível)
   de 27 balancetes de 2024 a 2026 e dos 6 de 2026-09 em layout antigo.
   Nenhum reduzido apareceu com dois códigos diferentes.

   Reduzido fora desta tabela NÃO é adivinhado: o parser marca a linha
   como `conta_incompleta` e a revisão pede a rubrica quando o pedaço
   cortado pode mudá-la (ver classificarContaCortada no parser).

   Para acrescentar uma conta: copie código, reduzido e descrição de um
   balancete em que a linha venha com o código inteiro.
   ============================================================ */

export const FUNAPE_CONTAS = {
  "2512006"  : ["7.1.1.01.02.00006", "( + ) APROPRIACAO DE RENDIMENTO"],
  "2596789"  : ["7.1.1.01.02.96789", "( + ) APROPRIACAO DE RECEITA CON"],
  "258422"   : ["7.1.1.01.07.00001", "( + ) APROPRIACAO DE RENDIMENTO"],
  "2597681"  : ["7.1.1.01.07.00005", "GANHO VAR CAMBIAL S/ IMPORT BENS"],
  "2591281"  : ["7.1.1.01.09.91281", "( + ) TRANSF. NUM ENTRE CENTRO D"],
  "2591282"  : ["7.1.1.01.09.91282", "( - ) TRANSF. NUM ENTRE CENTRO D"],
  "71199553" : ["7.1.1.08.20.99553", "RECUPERACAO DESPESAS BANCARIAS"],
  "71198672" : ["7.1.1.08.22.98672", "RECUPERACAO DESP APAR. EQUIP/UTE"],
  "71198772" : ["7.1.1.08.22.98772", "RECUPERACAO DESP EQUIP DE INFORM"],
  "71197012" : ["7.1.1.08.50.97012", "( + ) TRANSF ADTO IMPORT DE DESP"],
  "2501001"  : ["7.1.3.01.01.00001", "SALARIOS"],
  "2501007"  : ["7.1.3.01.01.00007", "( - ) 13º SALARIO"],
  "2501016"  : ["7.1.3.01.01.00016", "( - ) FÉRIAS"],
  "2502001"  : ["7.1.3.01.02.00001", "DESPESA C/ FGTS S/FOLHA (PRJ)"],
  "2502002"  : ["7.1.3.01.02.00002", "( - ) CONTRIBUIÇÃO PREVIDENCIARI"],
  "2502004"  : ["7.1.3.01.02.00004", "( - ) PIS S/ FOLHA"],
  "2502010"  : ["7.1.3.01.02.00010", "( - ) FGTS S/FÉRIAS PRJ"],
  "2502014"  : ["7.1.3.01.02.00014", "( - ) INSS S/FÉRIAS PRJ"],
  "2502015"  : ["7.1.3.01.02.00015", "( - ) INSS S/13º SALARIO PRJ"],
  "2503005"  : ["7.1.3.01.03.00005", "VALE ALIMENTAÇÃO FUNCIONÁRIOS"],
  "2503001"  : ["7.1.3.02.01.00001", "DESPESAS C/ DIARIAS NO PAIS"],
  "2503002"  : ["7.1.3.02.01.00002", "DIÁRIAS NO EXTERIOR"],
  "2504001"  : ["7.1.3.03.01.00001", "COMBUSTIVEIS E LUBRIFICANTES"],
  "2504003"  : ["7.1.3.03.01.00003", "GENERO DE ALIMENTAÇÃO"],
  "2504004"  : ["7.1.3.03.01.00004", "MATERIAL FARMACOLOGICO E MEDICAM"],
  "2504006"  : ["7.1.3.03.01.00006", "MATERIAL DE CONSUMO"],
  "2504008"  : ["7.1.3.03.01.00008", "MATERIAL DE EXPEDIENTE"],
  "2504009"  : ["7.1.3.03.01.00009", "MATERIAL DE INFORMATICA"],
  "2504010"  : ["7.1.3.03.01.00010", "MATERIAL ACONDICIONAMENTO E EMBA"],
  "2504013"  : ["7.1.3.03.01.00013", "MATERIAL DE LIMPEZA E PROD. DE H"],
  "2504017"  : ["7.1.3.03.01.00017", "MATERIAL ELETRICO E ELETRONICO P"],
  "2504023"  : ["7.1.3.03.01.00023", "FERRAMENTAS"],
  "2591999"  : ["7.1.3.03.01.91999", "MATERIAL MANUTENÇÃO MAQ. E EQUIP"],
  "2597120"  : ["7.1.3.03.01.97120", "MATERIAL DE CONSUMO, INSUMOS GRÁ"],
  "2579142"  : ["7.1.3.04.01.09142", "BOLSA DOAÇÃO"],
  "2506001"  : ["7.1.3.05.01.00001", "DESPESAS COM ASSINATURAS PERÍODI"],
  "2506004"  : ["7.1.3.05.01.00004", "SERVIÇOS TECNICOS PROFISSIONAIS"],
  "2506008"  : ["7.1.3.05.01.00008", "LOCAÇÃO MAQU. E EQUIPAMENTOS"],
  "2506011"  : ["7.1.3.05.01.00011", "MANUT. CONSERV. MAQ. EQUIPAMENTO"],
  "2506014"  : ["7.1.3.05.01.00014", "EXPOSIÇÃO, CONGRESSO, OFICINA E"],
  "2506018"  : ["7.1.3.05.01.00018", "DESPESA COM ALIMENTACAO E REFEIC"],
  "2506027"  : ["7.1.3.05.01.00027", "SERVIÇOS ANALISE PESQU CIENTIFI"],
  "2506035"  : ["7.1.3.05.01.00035", "SERVIÇOS GRAFICOS"],
  "2506039"  : ["7.1.3.05.01.00039", "CONFECÇÃO UNIFORMES, BAND. FLAMU"],
  "2506042"  : ["7.1.3.05.01.00042", "PASSAGENS E DEPESAS COM LOCOMOÇÃ"],
  "2506043"  : ["7.1.3.05.01.00043", "FRETES, TRANSP. CARGAS E ENCOMEN"],
  "2506045"  : ["7.1.3.05.01.00045", "HOSPEDAGENS"],
  "2506048"  : ["7.1.3.05.01.00048", "SERV. TELEFONIA MÓVEL CELULAR"],
  "2506049"  : ["7.1.3.05.01.00049", "SERV. TELEFONIA FIXA /INTERNET"],
  "252475"   : ["7.1.3.05.01.00051", "DESPESA ADM E OPERACIONAL (DAO)"],
  "2506054"  : ["7.1.3.05.01.00054", "DESPESA SERVIÇOS BANCÁRIOS"],
  "252476"   : ["7.1.3.05.01.00062", "FUNDO INSTITUCIONAL"],
  "252477"   : ["7.1.3.05.01.00063", "FUNDO LOCAL"],
  "2506069"  : ["7.1.3.05.01.00069", "DESPESAS ACESSORIAS COM IMPORTAC"],
  "2506072"  : ["7.1.3.05.01.00072", "DESPESA ADM E OPERACIONAL (DAO)"],
  "2506099"  : ["7.1.3.05.01.00099", "OUTROS SERVIÇOS TERCEIROS PJ"],
  "2599524"  : ["7.1.3.05.01.00129", "( - ) FRETES E TRANSP S/ IMPORTA"],
  "2599525"  : ["7.1.3.05.01.00130", "( - ) DESPESAS ACESSORIAS COM IM"],
  "2592279"  : ["7.1.3.05.01.92194", "SERVICO DE MEDICINA NO TRABALHO"],
  "2592446"  : ["7.1.3.05.01.92446", "CESSAO USO/LICENCIAMENTO DE SOFT"],
  "2593482"  : ["7.1.3.05.01.93482", "REALIZAÇÃO DE EVENTOS (CONGRESSO"],
  "2597014"  : ["7.1.3.05.01.97014", "LOCAÇÃO DE VEICULOS SEM MOTORIST"],
  "2599520"  : ["7.1.3.05.01.99520", "FUNDO LOCAL CIP"],
  "2599521"  : ["7.1.3.05.01.99521", "FUNDO INSTITUCIONAL CIP"],
  "2508003"  : ["7.1.3.20.50.00003", "APAR. EQUIPAMENTOS/ UTENSILIOS"],
  "2508008"  : ["7.1.3.20.50.00008", "EQUIP. AUDIO, VIDEO E FOTO"],
  "2508009"  : ["7.1.3.20.50.00009", "EQUIPAMENTOS DE INFORMATICA - PR"],
  "2508017"  : ["7.1.3.20.50.00017", "EQUIPAMENTOS DIVERSOS"],
  "2599869"  : ["7.1.3.20.50.09869", "IMPORTAÇÃO EM ANDAMENTO - BENS P"],
  "2595092"  : ["7.1.3.20.51.00002", "( - ) VARIAÇÃO CAMBIAL NEGATIVA"],
  "2532008"  : ["7.1.3.50.02.00008", "TRANSF. DE DIREITOS E OBRIGAÇOE"],
  "2532999"  : ["7.1.3.50.02.09999", "OUTRAS DOAÇÕES"],
  "2594664"  : ["7.1.3.50.02.94664", "DOAÇÕES DE BENS ENTRE C.C"],
  "258942"   : ["7.1.3.50.06.08942", "DOAÇÕES DE BENS DE PROJETOS"],
  "2599330"  : ["7.1.3.60.01.00001", "IR S/APLICAÇÃO FINANCEIRA"],
  "2599331"  : ["7.1.3.60.01.00002", "IOF S/APLICAÇÃO FINANCEIRA"],
  "735154"   : ["7.1.3.60.02.35154", "ICMS DIFERENCIAL DE ALIQUOTA (DI"],
  "94123"    : ["7.1.3.62.01.94123", "PERDA COM VARIACAO CAMBIAL S/ IM"],
  "2598298"  : ["7.1.3.62.01.98298", "DESPESA COM IOF S/ RECEBIMENTO D"],
  "2598299"  : ["7.1.3.62.01.98299", "DESPESA COM TAXA DE NACIONALIZAC"],
};
