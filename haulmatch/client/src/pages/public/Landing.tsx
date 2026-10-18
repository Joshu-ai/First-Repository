import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { LoadWithMatch, MatchCheck } from '../../../../shared/types';
import { ButtonLink } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { LoadCard } from '../../components/LoadCard';
import { MatchChecks } from '../../components/MatchDetails';
import { useDocumentTitle } from '../../lib/hooks';
import { paths } from '../../lib/routes';
import { HotshotArt, SemiArt, ShipperArt } from './illustrations';

/** An illustrative load for the hero, built around "tomorrow 8 AM" so the time label reads naturally. */
function useExampleLoad(): LoadWithMatch {
  return useMemo(() => {
    const now = new Date();
    const pickup = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0);
    const pickupEnd = new Date(pickup.getTime() + 4 * 3_600_000);
    const iso = (d: Date) => d.toISOString();
    return {
      id: 'example',
      shipperId: 'example',
      shipperName: 'Example shipper',
      shipperCompany: 'Example shipper',
      status: 'open',
      origin: { cityId: 'houston-tx', city: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698 },
      destination: { cityId: 'odessa-tx', city: 'Odessa', state: 'TX', lat: 31.8457, lng: -102.3676 },
      pickupStart: iso(pickup),
      pickupEnd: iso(pickupEnd),
      deliveryBy: null,
      equipmentTypes: ['HS_GOOSENECK', 'FLATBED'],
      weightLbs: 9_200,
      lengthFt: 32,
      commodity: 'Oilfield pipe',
      notes: '',
      loadSize: 'full',
      hazmat: false,
      tarpRequired: false,
      teamRequired: false,
      rateUsd: 1_400,
      miles: 514,
      ratePerMile: 2.72,
      bookingMode: 'instant',
      referenceNumber: null,
      bookedDriverId: null,
      bookedRateUsd: null,
      pendingRequestCount: 0,
      createdAt: iso(now),
      updatedAt: iso(now),
      pickedUpAt: null,
      deliveredAt: null,
      match: {
        eligible: true,
        score: 91,
        deadheadMiles: 18,
        loadedMiles: 514,
        totalMiles: 532,
        effectiveRatePerMile: 2.63,
        fuelCostUsd: 181,
        estimatedProfitUsd: 1_219,
        matchedEquipment: ['HS_GOOSENECK'],
        checks: [],
        highlights: ['Pickup is close by', 'Pays above market'],
        breakdown: { deadhead: 88, rate: 96, fit: 92, timing: 100, lane: 60 },
      },
    };
  }, []);
}

const EXAMPLE_CHECKS: MatchCheck[] = [
  { key: 'equipment', ok: true, hard: true, label: 'Your gooseneck works' },
  { key: 'weight', ok: true, hard: true, label: '9,200 lbs of your 10,000 lbs capacity, no CDL needed' },
  { key: 'length', ok: true, hard: true, label: '32 ft fits your 40 ft deck' },
  { key: 'deadhead', ok: true, hard: true, label: '18 mi deadhead to pickup' },
];

interface EntryCardProps {
  to: string;
  title: string;
  art: ReactNode;
  cta: string;
  children: ReactNode;
}

function EntryCard({ to, title, art, cta, children }: EntryCardProps) {
  return (
    <Link to={to} className="entry-card">
      <span className="entry-card__art">{art}</span>
      <h3 className="entry-card__title">{title}</h3>
      <p className="entry-card__body">{children}</p>
      <span className="entry-card__cta">
        {cta}
        <Icon name="arrowRight" size={18} />
      </span>
    </Link>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="steps__item">
      <div>
        <h4 className="steps__title">{title}</h4>
        <p className="steps__body">{children}</p>
      </div>
    </li>
  );
}

function Feature({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="feature">
      <span className="feature__icon" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="feature__title">{title}</h3>
      <p className="feature__body">{children}</p>
    </div>
  );
}

export default function Landing() {
  useDocumentTitle('Loads that fit your rig');
  const example = useExampleLoad();

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero__inner">
          <div className="hero__copy">
            <p className="hero__kicker">
              <Icon name="truck" size={16} />
              For hotshot and semi drivers, and the shippers who need them
            </p>
            <h1 className="hero__title" id="hero-title">
              Loads that <em>fit your rig.</em>
            </h1>
            <p className="hero__lede">
              HaulMatch checks every load against your equipment, payload, deck length, CDL and deadhead, then ranks
              what is left by what you would actually clear after fuel. No scrolling past freight you can’t haul.
            </p>
            <div className="hero__ctas">
              <ButtonLink to={paths.signup('driver')} size="lg" iconAfter="arrowRight">
                Find loads for my truck
              </ButtonLink>
              <ButtonLink to={paths.signup('shipper')} size="lg" variant="secondary" className="btn--on-dark">
                Post a load
              </ButtonLink>
            </div>
            <p className="hero__note">
              Free to join. Want a look first? <Link to={paths.login()}>Try a demo account</Link>.
            </p>
          </div>

          <div className="hero__preview">
            <p className="hero__preview-label">
              <Icon name="eye" size={16} />
              Example load, as a hotshot driver sees it
            </p>
            <LoadCard load={example} match={example.match} showShipper={false} />
            <div className="hero__checks">
              <MatchChecks checks={EXAMPLE_CHECKS} />
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="entry-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">Start here</p>
            <h2 className="section__title" id="entry-title">
              Which seat are you in?
            </h2>
            <p className="section__lede">Pick your side and we set up the board around it.</p>
          </div>
          <div className="grid-3">
            <EntryCard to={paths.signup('driver', 'hotshot')} title="I run hotshot" cta="Set up my hotshot" art={<HotshotArt />}>
              Dually with a gooseneck, bumper pull, dovetail or car hauler. Loads over the non-CDL weight line are
              flagged before you waste a call.
            </EntryCard>
            <EntryCard to={paths.signup('driver', 'semi')} title="I drive a semi" cta="Set up my truck" art={<SemiArt />}>
              Dry van, reefer, flatbed, step deck, RGN, Conestoga, tanker or power only. Hazmat and tanker loads only
              show when your endorsements are on file.
            </EntryCard>
            <EntryCard to={paths.signup('shipper')} title="I ship freight" cta="Start posting loads" art={<ShipperArt />}>
              Shippers and brokers post a load in a couple of minutes, get a suggested rate, and see which carriers fit
              before anyone picks up the phone.
            </EntryCard>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="how-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">How it works</p>
            <h2 className="section__title" id="how-title">
              Less searching, fewer dead calls
            </h2>
          </div>
          <div className="grid-2" style={{ gap: 'var(--space-6)' }}>
            <div className="how-col">
              <h3 className="how-col__title">
                <Icon name="truck" size={22} />
                For drivers
              </h3>
              <ol className="steps">
                <Step title="Tell us your rig">
                  Equipment, deck length, payload, CDL and endorsements, plus where you are empty and how far you will
                  deadhead.
                </Step>
                <Step title="See loads ranked for you">
                  Every load gets a 0–100 match score from deadhead, all-in $/mi, timing, fit and lane. Loads you can’t
                  legally or physically haul stay out of the way.
                </Step>
                <Step title="Book it or make an offer">
                  Instant-book loads are yours in a tap. Others go to the shipper as a request, with a counter-offer if
                  you want one. Then line up a backhaul from where you deliver.
                </Step>
              </ol>
            </div>
            <div className="how-col">
              <h3 className="how-col__title">
                <Icon name="building" size={22} />
                For shippers and brokers
              </h3>
              <ol className="steps">
                <Step title="Post the load">
                  Lane, pickup window, weight, length and the equipment you will accept. Hotshot and semi can both bid on
                  the same load, and you get a suggested rate for the lane.
                </Step>
                <Step title="See who fits">
                  Recommended drivers whose rig, capacity and location match, with their deadhead to your dock. Invite
                  the ones you like.
                </Step>
                <Step title="Book and track">
                  Accept a request or let qualified drivers instant-book. Message the driver and follow pickup and
                  delivery as it happens.
                </Step>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="why-title">
        <div className="container stack-xl">
          <div>
            <div className="section__head">
              <p className="eyebrow">Why HaulMatch</p>
              <h2 className="section__title" id="why-title">
                Built for the truck you actually drive
              </h2>
              <p className="section__lede">
                A generic load board shows everything and leaves the math to you. HaulMatch does the checking up front.
              </p>
            </div>
            <div className="grid-3">
              <Feature icon="shield" title="Matching that knows your rig">
                Equipment, weight, deck length, CDL, hazmat and tanker endorsements and team requirements are checked
                before a load reaches your list.
              </Feature>
              <Feature icon="dollar" title="All-in $/mi with deadhead">
                The rate divided by loaded plus empty miles, so a fat rate 200 miles away doesn’t look better than it is.
              </Feature>
              <Feature icon="fuel" title="Profit after fuel">
                Estimated from your own MPG and fuel price, right on the load card, so you can compare loads at a
                glance.
              </Feature>
              <Feature icon="bolt" title="Instant book">
                When a shipper marks a load instant, the first qualified driver gets it. No phone tag, no waiting on a
                callback.
              </Feature>
              <Feature icon="route" title="Backhauls built in">
                Every load shows open freight near its delivery, matched for when you will be empty, so the return trip
                pays too.
              </Feature>
              <Feature icon="siren" title="Live load alerts">
                Save a search and get pinged the moment a matching load posts, with hot matches near you called out.
              </Feature>
            </div>
          </div>

          <div className="cta-band">
            <div className="stack-sm">
              <h2 className="cta-band__title">Your next load should fit the first time.</h2>
              <p>Create a free account, or poke around with a demo driver or shipper login.</p>
            </div>
            <div className="row">
              <ButtonLink to={paths.signup()} size="lg">
                Create free account
              </ButtonLink>
              <ButtonLink to={paths.login()} size="lg" variant="secondary" className="btn--on-dark">
                Try the demo
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
