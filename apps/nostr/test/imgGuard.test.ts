/**
 * Le proxy d'images va chercher une URL fournie par un inconnu : ces contrôles
 * sont la seule chose qui l'empêche d'être un SSRF. Chaque cas refusé ici est
 * une cible réelle — métadonnées cloud, boucle locale, réseau interne.
 */
import { describe, it, expect } from 'vitest'
import { isPublicIp, parseTarget } from '../server/utils/imgGuard'

describe('parseTarget', () => {
  it('accepte http et https', () => {
    expect(parseTarget('https://media.exemple.io/a.png').hostname).toBe('media.exemple.io')
    expect(parseTarget('http://exemple.fr/a.png').hostname).toBe('exemple.fr')
  })

  it('refuse les schémas qui ne sont pas du web', () => {
    for (const raw of ['file:///etc/passwd', 'ftp://exemple.fr/a.png', 'data:image/png;base64,AAA', 'gopher://x/1']) {
      expect(() => parseTarget(raw), raw).toThrow()
    }
  })

  it('refuse ce qui détourne l’adresse : identifiants, port exotique', () => {
    expect(() => parseTarget('https://user:pass@exemple.fr/a.png')).toThrow()
    expect(() => parseTarget('http://exemple.fr:2375/a.png')).toThrow()
  })
})

describe('isPublicIp', () => {
  it('accepte les adresses de l’internet public', () => {
    for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700::1111']) {
      expect(isPublicIp(ip), ip).toBe(true)
    }
  })

  it('refuse la boucle locale, le privé, le lien-local et le CGNAT', () => {
    for (const ip of [
      '127.0.0.1',
      '0.0.0.0',
      '10.0.0.7',
      '172.16.3.4',
      '192.168.1.1',
      '169.254.169.254', // métadonnées cloud : la cible classique
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isPublicIp(ip), ip).toBe(false)
    }
  })

  it('refuse les équivalents IPv6, y compris une v4 déguisée', () => {
    for (const ip of ['::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '2002::1', '64:ff9b::7f00:1']) {
      expect(isPublicIp(ip), ip).toBe(false)
    }
  })

  it('refuse ce qui n’est pas une adresse', () => {
    expect(isPublicIp('exemple.fr')).toBe(false)
    expect(isPublicIp('')).toBe(false)
  })
})
