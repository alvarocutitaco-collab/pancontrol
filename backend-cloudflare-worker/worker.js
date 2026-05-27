const OPENAI_URL = "https://api.openai.com/v1/responses";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const facturaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tipo_documento: { type: "string" },
    numero_documento: { type: "string" },
    fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD si se puede detectar" },
    proveedor: { type: "string" },
    moneda: { type: "string" },
    subtotal: { type: "number" },
    igv: { type: "number" },
    descuento_global: { type: "number" },
    cargos_globales: { type: "number" },
    total: { type: "number" },
    precios_incluyen_igv: { type: "boolean" },
    metodo_prorrateo: { type: "string" },
    confianza: { type: "number" },
    advertencias: { type: "array", items: { type: "string" } },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          insumo: { type: "string" },
          descripcion_original: { type: "string" },
          cantidad: { type: "number" },
          unidad: { type: "string" },
          presentacion: { type: "string" },
          trae: { type: "number" },
          unidad_interna: { type: "string" },
          contenido_cu: { type: "number" },
          unidad_base: { type: "string" },
          total_base: { type: "number" },
          precio_unitario_original: { type: "number" },
          precio_total_original: { type: "number" },
          descuento_linea: { type: "number" },
          precio_total_sin_igv: { type: "number" },
          igv_linea: { type: "number" },
          precio_unitario: { type: "number", description: "Precio unitario final para registrar, con descuentos e IGV aplicados" },
          precio_total: { type: "number", description: "Precio total final para registrar, con descuentos e IGV aplicados" },
          incluye_igv: { type: "boolean" },
          confianza: { type: "number" },
          observacion: { type: "string" }
        },
        required: ["insumo", "descripcion_original", "cantidad", "unidad", "presentacion", "trae", "unidad_interna", "contenido_cu", "unidad_base", "total_base", "precio_unitario_original", "precio_total_original", "descuento_linea", "precio_total_sin_igv", "igv_linea", "precio_unitario", "precio_total", "incluye_igv", "confianza", "observacion"]
      }
    }
  },
  required: ["tipo_documento", "numero_documento", "fecha", "proveedor", "moneda", "subtotal", "igv", "descuento_global", "cargos_globales", "total", "precios_incluyen_igv", "metodo_prorrateo", "confianza", "advertencias", "items"]
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ error: "Usa POST con multipart/form-data" }, 405);
    }

    if (!env.OPENAI_API_KEY) {
      return json({ error: "Falta configurar OPENAI_API_KEY en el Worker" }, 500);
    }

    try {
      const form = await request.formData();
      const file = form.get("documento");
      const catalogo = safeJson(form.get("catalogo_insumos"), []);
      const unidades = safeJson(form.get("unidades"), {});

      if (!file || typeof file === "string") {
        return json({ error: "No se recibio el archivo documento" }, 400);
      }

      const mime = file.type || "image/jpeg";
      if (mime === "image/heic" || mime === "image/heif") {
        return json({ error: "Formato HEIC/HEIF no compatible. Convierte la foto a JPG o toma una foto desde la camara de la app." }, 415);
      }
      if (!mime.startsWith("image/")) {
        return json({ error: "Por ahora sube una foto en JPG, PNG o WEBP. PDF se puede agregar despues." }, 415);
      }

      const base64 = await fileToBase64(file);
      const prompt = [
        "Eres un auditor de facturas y boletas para inventario de una panaderia en Peru.",
        "Tu tarea es extraer SOLO lineas reales de productos/insumos comprados. No extraigas subtotales, IGV, descuentos, percepciones, detracciones, envios, redondeos, anticipos ni formas de pago como items.",
        "Las columnas pueden llamarse de muchas formas:",
        "- producto, item, descripcion, detalle, concepto, articulo, mercaderia = descripcion_original",
        "- cant, cantidad, qty, und, unidades = cantidad",
        "- unidad, und, um, u.m. = unidad",
        "- p.u., pu, precio venta, precio unitario, unit price = precio_unitario_original cuando sea el precio cobrado por unidad",
        "- v/u, valor unitario, valor unit, valor venta unitario = valor unitario normalmente SIN IGV",
        "- importe, total, valor, valor venta, precio total, subtotal linea = precio_total_original",
        "- descuento, dscto, desc, bonif, descuento a, descuento b = descuento_linea o descuento_global",
        "",
        "Campos de control de stock por producto:",
        "- insumo: usa el nombre del producto leido en la factura.",
        "- presentacion: bolsa, saco, lata, caja, paquete, unidad, balde, tarro, etc. Si no se identifica, usa 'unidad'.",
        "- trae: numero de unidades internas que trae la presentacion. Caja x 20 paquetes = 20; bolsa/lata/saco individual = 1.",
        "- unidad_interna: paquete, bolsa, lata, unidad, saco, tarro, etc.",
        "- contenido_cu: contenido de cada unidad interna convertido a numero en unidad_base. Ejemplo: 500 g => contenido_cu 500 y unidad_base gramo; 10 kg => contenido_cu 10 y unidad_base kilogramo.",
        "- unidad_base: kilogramo, gramo, litro, mililitro, metro o unidad.",
        "- total_base: cantidad * trae * contenido_cu.",
        "",
        "Regla de negocio de PanControl:",
        "La app debe registrar cada producto con PRECIO FINAL CON IGV Y DESCUENTOS APLICADOS. Por eso precio_unitario y precio_total deben ser los valores finales para inventario, no necesariamente los valores brutos impresos.",
        "La suma de todos los precio_total de los items debe coincidir con el total final del documento con IGV, salvo diferencia de redondeo minima.",
        "",
        "Patrones reales de facturas peruanas que debes reconocer:",
        "A. Lineas SIN IGV + IGV al final: si la suma de la columna Total/Valor/Importe coincide con 'Total gravado', 'Valor venta', 'Op. gravadas' o con el subtotal antes de IGV, entonces cada linea esta sin IGV. precio_total final = linea_sin_igv * total_documento / base_gravada.",
        "B. Lineas CON IGV: si la suma de los importes de linea ya coincide con 'Total', 'Imp Total', 'Total a pagar' o el monto en letras, no agregues IGV otra vez. Marca incluye_igv=true.",
        "C. Descuento global: si aparece 'Total descuentos', 'Descuento (-)', '%desc', '%dsc', 'Dcto' o 'Dscto Especial' fuera de las lineas, no lo registres como item. Prorratealo entre los productos proporcionalmente a su valor bruto.",
        "D. Descuento por linea: si cada fila tiene columna DSCTO/%DSCT/%D1/%D2, resta ese descuento antes de aplicar IGV si el documento usa valores sin IGV.",
        "E. Cargos globales: embalaje, flete, portes, recargo, redondeo o cargos similares tampoco son items. Sumalos en cargos_globales y prorratealos si forman parte del total a pagar.",
        "F. Columnas V/U y P/U juntas: V/U suele ser valor unitario sin IGV; P/U suele ser precio unitario con IGV. Usa la columna que haga cuadrar los importes y el total del documento.",
        "G. Tickets angostos: si los importes de linea suman exactamente el TOTAL y abajo aparece SUB TOTAL + IGV, entonces los importes de linea ya incluyen IGV; no los multipliques por 1.18.",
        "H. Facturas en USD: conserva moneda USD o US$; igual debes cuadrar los importes con el total final.",
        "Reglas estrictas:",
        "1. Cuenta cada fila de producto visible una sola vez.",
        "2. Si hay 6 filas de productos visibles, devuelve 6 items. No dividas una misma descripcion en varios items.",
        "3. Si una fila continua en dos renglones, juntala como un solo item.",
        "4. Extrae los precios originales impresos en precio_unitario_original y precio_total_original.",
        "5. Extrae descuentos por linea en descuento_linea. Si hay descuentos globales, extraelos en descuento_global y prorratealos entre items proporcionalmente al valor de cada linea.",
        "6. Si el monto de linea impreso esta sin IGV, calcula precio_total_sin_igv y luego aplica IGV proporcional para obtener precio_total final con IGV.",
        "7. Si el documento tiene subtotal, IGV, descuentos globales, cargos o redondeos, distribuye esos importes proporcionalmente entre items para que la sumatoria final cuadre con el total del documento.",
        "8. Si precio_total final falta pero hay cantidad y precio_unitario final, calcula precio_total = cantidad * precio_unitario.",
        "9. Si precio_unitario final falta pero hay cantidad y precio_total final, calcula precio_unitario = precio_total / cantidad.",
        "10. Si el documento muestra subtotal/IGV/total, extraelos en los campos del documento, no como items.",
        "11. Determina precios_incluyen_igv comparando las columnas y totales. En Peru, si dice IGV 18% separado, normalmente los valores de venta de linea estan sin IGV; si la boleta solo muestra total, normalmente incluyen IGV.",
        "12. Si no estas seguro, usa confianza menor a 0.75 y escribe observacion/advertencias.",
        "13. Usa 0 solo cuando el dato realmente no aparece y no se puede calcular.",
        "14. No inventes productos ni cantidades que no se vean.",
        "15. En metodo_prorrateo explica brevemente como aplicaste descuentos e IGV: por ejemplo 'lineas sin IGV + descuento global prorrateado + IGV 18%'.",
        "16. Antes de responder, haz una auditoria numerica: compara suma de lineas brutas, descuento global, gravada/subtotal, IGV y total. Elige la interpretacion que cierre mejor con el total.",
        "17. Si hay varias interpretaciones, prioriza la que haga que sum(precio_total) sea igual al TOTAL A PAGAR y deja advertencia breve.",
        "Usa el catalogo solo para normalizar insumo cuando la coincidencia sea clara; conserva siempre descripcion_original con el texto leido.",
        "",
        "Catalogo de insumos:",
        JSON.stringify(catalogo.slice(0, 250)),
        "",
        "Unidades configuradas:",
        JSON.stringify(unidades)
      ].join("\n");

      const ai = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4.1-mini",
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: `data:${mime};base64,${base64}` }
            ]
          }],
          text: {
            format: {
              type: "json_schema",
              name: "factura_insumos_panaderia",
              strict: true,
              schema: facturaSchema
            }
          }
        })
      });

      const raw = await ai.text();
      if (!ai.ok) {
        console.error("OPENAI_ERROR", raw);
        return json({ error: "OpenAI no pudo procesar el documento", detalle: raw }, 502);
      }

      const data = JSON.parse(raw);
      const parsed = normalizeInvoice(extractOutputJson(data));
      return json(parsed);
    } catch (error) {
      return json({ error: error.message || "Error procesando documento" }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(String(value)) : fallback;
  } catch {
    return fallback;
  }
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function extractOutputJson(response) {
  if (response.output_parsed) return response.output_parsed;
  const msg = response.output?.find(item => item.type === "message");
  const text = msg?.content?.find(part => part.type === "output_text")?.text || response.output_text;
  if (!text) throw new Error("La IA no devolvio texto JSON");
  return JSON.parse(text);
}

function normalizeInvoice(doc) {
  const items = Array.isArray(doc.items) ? doc.items : [];
  doc.items = items
    .filter(item => item && Number(item.cantidad || 0) > 0 && String(item.insumo || item.descripcion_original || "").trim())
    .map(item => {
      const cantidad = Number(item.cantidad || 0);
      const precioUnitarioOriginal = Number(item.precio_unitario_original || item.precio_unitario || 0);
      const precioTotalOriginal = Number(item.precio_total_original || item.precio_total || 0);
      const descuentoLinea = Number(item.descuento_linea || 0);
      let precioTotalSinIgv = Number(item.precio_total_sin_igv || 0);
      let precioUnitario = Number(item.precio_unitario || 0);
      let precioTotal = Number(item.precio_total || 0);
      if (precioTotal <= 0 && precioTotalOriginal > 0) precioTotal = precioTotalOriginal - descuentoLinea;
      if (precioTotalSinIgv <= 0 && precioTotalOriginal > 0 && !item.incluye_igv) precioTotalSinIgv = Math.max(0, precioTotalOriginal - descuentoLinea);
      if (precioTotal <= 0 && precioUnitario > 0 && cantidad > 0) precioTotal = round2(precioUnitario * cantidad);
      if (precioUnitario <= 0 && precioTotal > 0 && cantidad > 0) precioUnitario = round4(precioTotal / cantidad);
      return {
        ...item,
        insumo: String(item.insumo || item.descripcion_original || "").trim(),
        descripcion_original: String(item.descripcion_original || item.insumo || "").trim(),
        cantidad,
        unidad: String(item.unidad || item.presentacion || "unidad").trim() || "unidad",
        presentacion: String(item.presentacion || item.unidad || "unidad").trim() || "unidad",
        trae: Number(item.trae || 1) || 1,
        unidad_interna: String(item.unidad_interna || item.presentacion || item.unidad || "unidad").trim() || "unidad",
        contenido_cu: Number(item.contenido_cu || 1) || 1,
        unidad_base: String(item.unidad_base || "unidad").trim() || "unidad",
        total_base: Number(item.total_base || 0) || round4(cantidad * (Number(item.trae || 1) || 1) * (Number(item.contenido_cu || 1) || 1)),
        precio_unitario_original: precioUnitarioOriginal,
        precio_total_original: precioTotalOriginal,
        descuento_linea: descuentoLinea,
        precio_total_sin_igv: precioTotalSinIgv,
        igv_linea: Number(item.igv_linea || 0),
        precio_unitario: precioUnitario,
        precio_total: precioTotal,
        incluye_igv: Boolean(item.incluye_igv),
        confianza: Number(item.confianza || doc.confianza || 0),
        observacion: String(item.observacion || "").trim()
      };
    });

  doc.subtotal = Number(doc.subtotal || 0);
  doc.igv = Number(doc.igv || 0);
  doc.descuento_global = Number(doc.descuento_global || 0);
  doc.cargos_globales = Number(doc.cargos_globales || 0);
  doc.total = Number(doc.total || 0);
  doc.moneda = doc.moneda || "PEN";
  doc.advertencias = Array.isArray(doc.advertencias) ? doc.advertencias : [];
  reconcileInvoiceTotals(doc);
  return doc;
}

function reconcileInvoiceTotals(doc) {
  if (!doc.items.length) return;
  const sumFinal = round2(doc.items.reduce((sum, item) => sum + Number(item.precio_total || 0), 0));
  const sumOriginal = round2(doc.items.reduce((sum, item) => sum + Number(item.precio_total_original || item.precio_total || 0), 0));
  const sumSinIgv = round2(doc.items.reduce((sum, item) => sum + Number(item.precio_total_sin_igv || 0), 0));
  if (!Number(doc.total || 0)) {
    doc.total = sumFinal || sumOriginal || sumSinIgv;
    return;
  }
  const target = round2(doc.total);
  if (isClose(sumFinal, target)) {
    doc.items = fixLastCent(doc.items, target);
    return;
  }
  if (isClose(sumOriginal, target)) {
    applyFinalTotals(doc, item => Number(item.precio_total_original || item.precio_total || 0), sumOriginal, "Los importes de linea ya incluyen IGV; no se agrego IGV nuevamente.");
    doc.precios_incluyen_igv = true;
    return;
  }
  if (doc.subtotal > 0 && (isClose(sumOriginal, doc.subtotal) || isClose(sumSinIgv, doc.subtotal))) {
    const baseField = isClose(sumSinIgv, doc.subtotal) ? "precio_total_sin_igv" : "precio_total_original";
    applyFinalTotals(doc, item => Number(item[baseField] || item.precio_total_original || item.precio_total || 0), doc.subtotal, "Lineas sin IGV; IGV/cargos/descuentos aplicados proporcionalmente al total.");
    doc.precios_incluyen_igv = false;
    return;
  }
  const netAfterDiscount = round2(sumOriginal - Number(doc.descuento_global || 0));
  if (doc.descuento_global > 0 && doc.subtotal > 0 && isClose(netAfterDiscount, doc.subtotal)) {
    applyFinalTotals(doc, item => Number(item.precio_total_original || item.precio_total || 0), sumOriginal, "Descuento global prorrateado; IGV/cargos aplicados proporcionalmente.");
    doc.precios_incluyen_igv = false;
    return;
  }
  if (doc.igv > 0 && isClose(round2(sumOriginal + doc.igv + Number(doc.cargos_globales || 0)), target)) {
    applyFinalTotals(doc, item => Number(item.precio_total_original || item.precio_total || 0), sumOriginal, "Lineas sin IGV; IGV/cargos aplicados proporcionalmente.");
    doc.precios_incluyen_igv = false;
    return;
  }
  const bestBase = chooseBestBase(doc, { sumFinal, sumOriginal, sumSinIgv });
  if (bestBase.sum > 0) {
    applyFinalTotals(doc, bestBase.getter, bestBase.sum, bestBase.reason);
  }
}

function chooseBestBase(doc, sums) {
  const candidates = [
    {
      sum: sums.sumFinal,
      getter: item => Number(item.precio_total || 0),
      reason: "Total final prorrateado desde importes calculados por IA."
    },
    {
      sum: sums.sumOriginal,
      getter: item => Number(item.precio_total_original || item.precio_total || 0),
      reason: "Total final prorrateado desde importes originales impresos."
    },
    {
      sum: sums.sumSinIgv,
      getter: item => Number(item.precio_total_sin_igv || 0),
      reason: "Total final prorrateado desde importes sin IGV."
    }
  ].filter(c => c.sum > 0);
  const reference = doc.subtotal > 0 ? doc.subtotal : doc.total;
  candidates.sort((a, b) => Math.abs(a.sum - reference) - Math.abs(b.sum - reference));
  return candidates[0] || { sum: 0, getter: () => 0, reason: "" };
}

function applyFinalTotals(doc, getBaseAmount, base, reason) {
  const target = round2(doc.total);
  if (!target || !base) return;
  let running = 0;
  doc.items = doc.items.map((item, index) => {
    const baseAmount = Math.max(0, Number(getBaseAmount(item) || 0));
    const factor = baseAmount / base;
    let finalTotal = index === doc.items.length - 1 ? round2(target - running) : round2(target * factor);
    running = round2(running + finalTotal);
    const sinIgv = doc.igv > 0 ? round2(finalTotal / 1.18) : Number(item.precio_total_sin_igv || finalTotal);
    return {
      ...item,
      precio_total: finalTotal,
      precio_unitario: item.cantidad > 0 ? round4(finalTotal / item.cantidad) : 0,
      precio_total_sin_igv: item.precio_total_sin_igv > 0 ? item.precio_total_sin_igv : sinIgv,
      igv_linea: doc.igv > 0 ? round2(finalTotal - sinIgv) : Number(item.igv_linea || 0),
      observacion: [item.observacion, reason].filter(Boolean).join(" | ")
    };
  });
  doc.items = fixLastCent(doc.items, target);
  doc.metodo_prorrateo = doc.metodo_prorrateo || reason;
  doc.advertencias.push(`${reason} Suma final de lineas: ${target}.`);
}

function fixLastCent(items, target) {
  const diff = round2(target - items.reduce((sum, item) => sum + Number(item.precio_total || 0), 0));
  if (!items.length || Math.abs(diff) > 0.05 || diff === 0) return items;
  const last = items[items.length - 1];
  const precioTotal = round2(Number(last.precio_total || 0) + diff);
  return items.map((item, index) => index === items.length - 1 ? {
    ...last,
    precio_total: precioTotal,
    precio_unitario: last.cantidad > 0 ? round4(precioTotal / last.cantidad) : 0
  } : item);
}

function isClose(a, b, tolerance = 0.1) {
  return Math.abs(round2(a) - round2(b)) <= tolerance;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}
