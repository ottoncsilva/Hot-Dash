import { redirect } from "next/navigation";

/**
 * O endereço antigo de Códigos de rastreio.
 *
 * Códigos deixou de ser uma página própria e virou uma aba do Rastreio, junto
 * de Links — os dois são o mesmo caminho do lead em dois pedaços, e trocar de
 * página para segui-lo era justamente o que atrapalhava. O endereço fica de pé
 * porque estava no menu e pode estar nos favoritos de quem abre esta tela todo
 * dia; some daqui e a pessoa cai num 404 sem entender que a tela apenas mudou
 * de lugar.
 */
export default function CodigosRedirect() {
  redirect("/dashboard/links?aba=codigos");
}
