import { describe, test, expect } from "vitest";
import { gerarUUID } from "../../apps/server/src/shared/ids.js";
import { Dinheiro } from "../../apps/server/src/shared/dinheiro.js";
import type { Local } from "../../apps/server/src/financeiro/modelos/local.js";
import type { Cliente, Fornecedor, ContaBancaria, Moeda } from "../../apps/server/src/financeiro/modelos/cadastros.js";
import type { Lançamento } from "../../apps/server/src/financeiro/modelos/lançamento.js";

describe("Financeiro - Modelos", () => {
  describe("Local", () => {
    test("construir com todos os campos", () => {
      const local: Local = {
        id: gerarUUID(),
        pousada_id: gerarUUID(),
        nome: "Pousada Principal",
        ativo: true,
        parametros: {
          local_padrao_hospedagem: gerarUUID(),
          local_padrao_reserva: gerarUUID(),
        },
      };
      expect(local.nome).toBe("Pousada Principal");
      expect(local.ativo).toBe(true);
      expect(local.parametros.local_padrao_hospedagem).toBeDefined();
      expect(local.parametros.local_padrao_reserva).toBeDefined();
    });
  });

  describe("Cliente", () => {
    test("construir cliente pessoa física", () => {
      const cliente: Cliente = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        nome: "João da Silva",
        cpf_cnpj: "123.456.789-00",
        tipo: "pessoa_fisica",
        contato: {
          email: "joao@example.com",
          telefone: "11999999999",
          endereco: {
            logradouro: "Rua das Flores",
            numero: "123",
            complemento: "Apto 10",
            bairro: "Centro",
            cidade: "São Paulo",
            estado: "SP",
            cep: "01310-100",
          },
        },
      };
      expect(cliente.tipo).toBe("pessoa_fisica");
      expect(cliente.nome).toBe("João da Silva");
      expect(cliente.contato.endereco.cidade).toBe("São Paulo");
    });

    test("construir cliente pessoa jurídica", () => {
      const cliente: Cliente = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        nome: "Empresa XYZ Ltda",
        cpf_cnpj: "12.345.678/0001-00",
        tipo: "pessoa_juridica",
        contato: {
          email: "contato@empresa.com",
          telefone: "1133334444",
          endereco: {
            logradouro: "Avenida Principal",
            numero: "456",
            bairro: "Vila Nova",
            cidade: "São Paulo",
            estado: "SP",
            cep: "01310-100",
          },
        },
      };
      expect(cliente.tipo).toBe("pessoa_juridica");
      expect(cliente.contato.endereco.numero).toBe("456");
    });

    test("endereco com complemento opcional", () => {
      const cliente: Cliente = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        nome: "Cliente Teste",
        cpf_cnpj: "111.222.333-44",
        tipo: "pessoa_fisica",
        contato: {
          email: "teste@example.com",
          telefone: "11988888888",
          endereco: {
            logradouro: "Rua Teste",
            numero: "999",
            bairro: "Bairro Teste",
            cidade: "São Paulo",
            estado: "SP",
            cep: "01310-100",
          },
        },
      };
      expect(cliente.contato.endereco.complemento).toBeUndefined();
    });
  });

  describe("Fornecedor", () => {
    test("construir fornecedor", () => {
      const fornecedor: Fornecedor = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        razao_social: "Fornecedora ABC Ltda",
        cnpj: "12.345.678/0001-00",
        contato: {
          email: "vendas@fornecedor.com",
          telefone: "1133334444",
          endereco: {
            logradouro: "Rua Industrial",
            numero: "100",
            bairro: "Distrito Industrial",
            cidade: "Guarulhos",
            estado: "SP",
            cep: "07025-000",
          },
        },
        banco: {
          banco: "001",
          agencia: "1234",
          conta: "567890",
        },
      };
      expect(fornecedor.razao_social).toBe("Fornecedora ABC Ltda");
      expect(fornecedor.banco.banco).toBe("001");
      expect(fornecedor.contato.endereco.cidade).toBe("Guarulhos");
    });
  });

  describe("ContaBancaria", () => {
    test("construir conta bancária", () => {
      const conta: ContaBancaria = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        nome: "Conta Corrente Principal",
        banco: "001",
        agencia: "1234",
        numero: "567890",
        tipo: "corrente",
        saldo_inicial: Dinheiro.de(100000),
        data_saldo_inicial: new Date("2026-01-01"),
        ativo: true,
      };
      expect(conta.nome).toBe("Conta Corrente Principal");
      expect(conta.tipo).toBe("corrente");
      expect(conta.ativo).toBe(true);
    });

    test("construir conta poupança", () => {
      const conta: ContaBancaria = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        nome: "Conta Poupança",
        banco: "001",
        agencia: "5678",
        numero: "987654",
        tipo: "poupanca",
        saldo_inicial: Dinheiro.de(50000),
        data_saldo_inicial: new Date("2026-01-01"),
        ativo: true,
      };
      expect(conta.tipo).toBe("poupanca");
    });

    test("Dinheiro integration - saldo_inicial.centavos", () => {
      const conta: ContaBancaria = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        nome: "Conta Teste",
        banco: "001",
        agencia: "1234",
        numero: "123456",
        tipo: "corrente",
        saldo_inicial: Dinheiro.de(12345),
        data_saldo_inicial: new Date("2026-01-01"),
        ativo: true,
      };
      expect(conta.saldo_inicial.centavos).toBe(12345);
    });
  });

  describe("Moeda", () => {
    test("construir moeda BRL", () => {
      const moeda: Moeda = {
        id: gerarUUID(),
        codigo: "BRL",
        nome: "Real Brasileiro",
        taxa_cambio: 1.0,
        ativo: true,
      };
      expect(moeda.codigo).toBe("BRL");
      expect(moeda.nome).toBe("Real Brasileiro");
      expect(moeda.taxa_cambio).toBe(1.0);
    });

    test("construir moeda USD", () => {
      const moeda: Moeda = {
        id: gerarUUID(),
        codigo: "USD",
        nome: "Dólar Americano",
        taxa_cambio: 5.25,
        ativo: true,
      };
      expect(moeda.codigo).toBe("USD");
      expect(moeda.taxa_cambio).toBe(5.25);
    });
  });

  describe("Lançamento", () => {
    test("construir lançamento simples", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date("2026-11-01"),
        tipo: "recebimento",
        origem: "hospedagem",
        valor: Dinheiro.de(50000),
        forma_pagamento: "dinheiro",
        status: "confirmado",
        descricao: "Hospedagem 01-03/11",
        auditoria: {
          criado_por: "user@example.com",
          data_criacao: new Date("2026-11-01T10:00:00Z"),
          dispositivo: "web",
        },
      };
      expect(lancamento.tipo).toBe("recebimento");
      expect(lancamento.origem).toBe("hospedagem");
      expect(lancamento.status).toBe("confirmado");
    });

    test("type narrowing - tipo recebimento", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        tipo: "recebimento",
        origem: "hospedagem",
        valor: Dinheiro.de(100000),
        forma_pagamento: "pix",
        status: "confirmado",
        descricao: "Pagamento via PIX",
        auditoria: {
          criado_por: "system@example.com",
          data_criacao: new Date(),
          dispositivo: "servidor",
        },
      };
      if (lancamento.tipo === "recebimento") {
        expect(lancamento.tipo).toBe("recebimento");
      }
    });

    test("type narrowing - origem reserva", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        tipo: "pagamento",
        origem: "reserva",
        valor: Dinheiro.de(25000),
        forma_pagamento: "credito",
        status: "pendente",
        descricao: "Sinal de reserva",
        auditoria: {
          criado_por: "gerente@example.com",
          data_criacao: new Date(),
          dispositivo: "mobile",
        },
      };
      if (lancamento.origem === "reserva") {
        expect(lancamento.origem).toBe("reserva");
      }
    });

    test("auditoria structure - campos obrigatórios", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        tipo: "ajuste",
        origem: "manual",
        valor: Dinheiro.de(10000),
        forma_pagamento: "transferencia",
        status: "liquidado",
        descricao: "Ajuste manual",
        auditoria: {
          criado_por: "admin@example.com",
          data_criacao: new Date(),
          dispositivo: "web",
        },
      };
      expect(lancamento.auditoria.criado_por).toBe("admin@example.com");
      expect(lancamento.auditoria.data_criacao).toBeInstanceOf(Date);
      expect(lancamento.auditoria.dispositivo).toBe("web");
    });

    test("auditoria structure - campos opcionais", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        tipo: "cancelado" as any,
        origem: "manual",
        valor: Dinheiro.de(5000),
        forma_pagamento: "dinheiro",
        status: "cancelado",
        descricao: "Lançamento cancelado",
        auditoria: {
          criado_por: "user@example.com",
          data_criacao: new Date(),
          dispositivo: "web",
          atualizado_por: "supervisor@example.com",
          data_atualizacao: new Date(),
          motivo_cancelamento: "Dupla lançamento",
          supervisor_autorizou: true,
        },
      };
      expect(lancamento.auditoria.atualizado_por).toBe("supervisor@example.com");
      expect(lancamento.auditoria.motivo_cancelamento).toBe("Dupla lançamento");
      expect(lancamento.auditoria.supervisor_autorizou).toBe(true);
    });

    test("campos opcionais - referencia_id e referencia_tipo", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        tipo: "recebimento",
        origem: "hospedagem",
        valor: Dinheiro.de(75000),
        forma_pagamento: "debito",
        status: "confirmado",
        descricao: "Recebimento checkout",
        auditoria: {
          criado_por: "sistema@example.com",
          data_criacao: new Date(),
          dispositivo: "servidor",
        },
      };
      expect(lancamento.referencia_id).toBeUndefined();
      expect(lancamento.referencia_tipo).toBeUndefined();
    });

    test("campos opcionais - categoria e hora", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        tipo: "recebimento",
        origem: "bar",
        valor: Dinheiro.de(12000),
        forma_pagamento: "dinheiro",
        status: "liquidado",
        descricao: "Consumo no bar",
        auditoria: {
          criado_por: "garcom@example.com",
          data_criacao: new Date(),
          dispositivo: "mobile",
        },
      };
      expect(lancamento.categoria).toBeUndefined();
      expect(lancamento.hora).toBeUndefined();
    });

    test("com referencia_id e categoria", () => {
      const checkoutId = gerarUUID();
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        tipo: "recebimento",
        origem: "hospedagem",
        categoria: "Hospedagem Diária",
        valor: Dinheiro.de(300000),
        forma_pagamento: "credito",
        status: "liquidado",
        descricao: "Hospedagem 3 noites",
        referencia_id: checkoutId,
        referencia_tipo: "checkout",
        auditoria: {
          criado_por: "recepcion@example.com",
          data_criacao: new Date(),
          dispositivo: "web",
        },
      };
      expect(lancamento.referencia_id).toBe(checkoutId);
      expect(lancamento.referencia_tipo).toBe("checkout");
      expect(lancamento.categoria).toBe("Hospedagem Diária");
    });

    test("Dinheiro integration - valor.centavos", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        tipo: "recebimento",
        origem: "hospedagem",
        valor: Dinheiro.de(123456),
        forma_pagamento: "pix",
        status: "confirmado",
        descricao: "Test",
        auditoria: {
          criado_por: "test@example.com",
          data_criacao: new Date(),
          dispositivo: "web",
        },
      };
      expect(lancamento.valor.centavos).toBe(123456);
    });

    test("todas as formas de pagamento", () => {
      const formasPagamento = [
        "dinheiro",
        "pix",
        "debito",
        "credito",
        "cheque",
        "boleto",
        "transferencia",
      ] as const;

      for (const forma of formasPagamento) {
        const lancamento: Lançamento = {
          id: gerarUUID(),
          local_id: gerarUUID(),
          data: new Date(),
          tipo: "recebimento",
          origem: "manual",
          valor: Dinheiro.de(10000),
          forma_pagamento: forma,
          status: "confirmado",
          descricao: "Test",
          auditoria: {
            criado_por: "test@example.com",
            data_criacao: new Date(),
            dispositivo: "web",
          },
        };
        expect(lancamento.forma_pagamento).toBe(forma);
      }
    });

    test("todos os tipos", () => {
      const tipos = ["recebimento", "pagamento", "transferencia", "ajuste"] as const;

      for (const tipo of tipos) {
        const lancamento: Lançamento = {
          id: gerarUUID(),
          local_id: gerarUUID(),
          data: new Date(),
          tipo,
          origem: "manual",
          valor: Dinheiro.de(10000),
          forma_pagamento: "dinheiro",
          status: "confirmado",
          descricao: "Test",
          auditoria: {
            criado_por: "test@example.com",
            data_criacao: new Date(),
            dispositivo: "web",
          },
        };
        expect(lancamento.tipo).toBe(tipo);
      }
    });

    test("todos os status", () => {
      const statuses = ["pendente", "confirmado", "liquidado", "cancelado"] as const;

      for (const status of statuses) {
        const lancamento: Lançamento = {
          id: gerarUUID(),
          local_id: gerarUUID(),
          data: new Date(),
          tipo: "recebimento",
          origem: "manual",
          valor: Dinheiro.de(10000),
          forma_pagamento: "dinheiro",
          status,
          descricao: "Test",
          auditoria: {
            criado_por: "test@example.com",
            data_criacao: new Date(),
            dispositivo: "web",
          },
        };
        expect(lancamento.status).toBe(status);
      }
    });

    test("com hora opcional", () => {
      const lancamento: Lançamento = {
        id: gerarUUID(),
        local_id: gerarUUID(),
        data: new Date(),
        hora: "14:30:00",
        tipo: "recebimento",
        origem: "bar",
        valor: Dinheiro.de(5000),
        forma_pagamento: "dinheiro",
        status: "liquidado",
        descricao: "Consumo bar",
        auditoria: {
          criado_por: "garcom@example.com",
          data_criacao: new Date(),
          dispositivo: "mobile",
        },
      };
      expect(lancamento.hora).toBe("14:30:00");
    });
  });
});
