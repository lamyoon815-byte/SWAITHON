/* Fused continuous Lab mapping. No fitted coefficients or evaluation models.
 * Build without fast-math/FMA contraction so the reference calculation remains
 * numerically comparable. A separate Python guard checks the actual final RGB.
 */
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#else
#define EXPORT __attribute__((visibility("default")))
#endif

/* Inputs are finite (checked by the binding); avoid CRT fmin/fmax calls. */
static float clip(float x) { return x<0.f ? 0.f : (x>1.f ? 1.f : x); }
#define TABLE_SIZE 65536
static float decoding[TABLE_SIZE+1], encoding[TABLE_SIZE+1], lab_curve[TABLE_SIZE+1];
EXPORT void initialize_tables(void) {
    for (int i=0;i<=TABLE_SIZE;++i) {
        double x=(double)i/TABLE_SIZE;
        decoding[i]=(float)(x<=.04045 ? x/12.92 : pow((x+.055)/1.055,2.4));
        encoding[i]=(float)(x<=.0031308 ? x*12.92 : 1.055*pow(x,1./2.4)-.055);
        lab_curve[i]=(float)(x>.008856451679 ? cbrt(x) : x/.128418549346+.137931034483);
    }
}
static float lookup_curve(float x,const float *table) {
    x=clip(x)*TABLE_SIZE;
    int i=(int)x;
    if (i>=TABLE_SIZE) return table[TABLE_SIZE];
    return table[i]+(x-i)*(table[i+1]-table[i]);
}
static float decode(float x) {
    return lookup_curve(x,decoding);
}
static float encode(float x) {
    return lookup_curve(x,encoding);
}
static float lab_f(float x) {
    return lookup_curve(x,lab_curve);
}
static float lab_inverse(float x) {
    return x > .206896551724f ? x*x*x : .128418549346f * (x - .137931034483f);
}
static void to_lab(const float *rgb, float *out) {
    float r=decode(rgb[0]), g=decode(rgb[1]), b=decode(rgb[2]);
    float x=lab_f((.4124564f*r + .3575761f*g + .1804375f*b) / .95047f);
    float y=lab_f(.2126729f*r + .7151522f*g + .0721750f*b);
    float z=lab_f((.0193339f*r + .1191920f*g + .9503041f*b) / 1.08883f);
    out[0]=116.f*y-16.f; out[1]=500.f*(x-y); out[2]=200.f*(y-z);
}
static void from_lab(const float *lab, float *out) {
    float y=(lab[0]+16.f)/116.f;
    float x=lab_inverse(y+lab[1]/500.f)*.95047f;
    float z=lab_inverse(y-lab[2]/200.f)*1.08883f;
    y=lab_inverse(y);
    out[0]=encode( 3.240454836f*x - 1.537138850f*y - .4985315469f*z);
    out[1]=encode(-.9692663899f*x + 1.876010929f*y + .04155608235f*z);
    out[2]=encode( .05564341960f*x - .2040258543f*y + 1.057225162f*z);
}

EXPORT void map_local(const float *source, const float *baseline,
                      const float *cube, float *out, size_t count, int size) {
    for (size_t pixel=0; pixel<count; ++pixel) {
        const float *rgb=source+pixel*3;
        float original[3], base[3], proposed[3], delta[3], fraction[3];
        int low[3];
        for (int c=0;c<3;++c) {
            float position=clip(rgb[c])*(size-1);
            low[c]=(int)position;
            if (low[c]>size-2) low[c]=size-2;
            fraction[c]=position-low[c];
        }
        to_lab(rgb,original); to_lab(baseline+pixel*3,base);
        float radius2=0.f, distance2=0.f;
        size_t index=((size_t)low[0]*size+low[1])*size+low[2];
        for (int c=0;c<3;++c) {
            float a=cube[index*3+c], b=cube[(index+1)*3+c];
            float x00=a+fraction[2]*(b-a);
            a=cube[(index+size)*3+c]; b=cube[(index+size+1)*3+c];
            float x01=a+fraction[2]*(b-a);
            a=cube[(index+size*size)*3+c]; b=cube[(index+size*size+1)*3+c];
            float x10=a+fraction[2]*(b-a);
            a=cube[(index+size*size+size)*3+c]; b=cube[(index+size*size+size+1)*3+c];
            float x11=a+fraction[2]*(b-a);
            float x0=x00+fraction[1]*(x01-x00), x1=x10+fraction[1]*(x11-x10);
            proposed[c]=base[c]+x0+fraction[0]*(x1-x0);
            delta[c]=proposed[c]-original[c];
            radius2+=(base[c]-original[c])*(base[c]-original[c]);
            distance2+=delta[c]*delta[c];
        }
        float denominator=distance2<1e-30f ? 1e-30f : distance2;
        float scale=distance2>radius2 ? sqrtf(radius2/denominator) : 1.f;
        for (int c=0;c<3;++c) proposed[c]=original[c]+scale*delta[c];
        from_lab(proposed,out+pixel*3);
    }
}

EXPORT void color_partners(const float *normal, const float *seen,
                           const double *share, double *partner, size_t count,
                           float minimum, float ratio) {
    for (size_t i=0;i<count;++i) partner[i]=0.;
    for (size_t i=0;i<count;++i) {
        for (size_t j=i+1;j<count;++j) {
            float x=normal[i*3]-normal[j*3];
            float y=normal[i*3+1]-normal[j*3+1];
            float z=normal[i*3+2]-normal[j*3+2];
            float squared=x*x; squared+=y*y; squared+=z*z;
            float before=sqrtf(squared);
            if (before<minimum) continue;
            x=seen[i*3]-seen[j*3]; y=seen[i*3+1]-seen[j*3+1]; z=seen[i*3+2]-seen[j*3+2];
            squared=x*x; squared+=y*y; squared+=z*z;
            if (sqrtf(squared)<ratio*before) {
                partner[i]+=share[j]; partner[j]+=share[i];
            }
        }
    }
}

/* Double-precision analytic objective, matching the Python reference. */
static const double XYZ_M[9]={
    .43394994055572506,.376209769903311,.18984028954096394,
    .2126729,.7151522,.072175,
    .01775658275396527,.10946796102238184,.8727754562236529};
static const double XYZ_INV[9]={
    3.079955107993268,-1.537138850102575,-.5428161041768079,
    -.9212586255851126,1.876010928842491,.04524750914152852,
    .05288740103121694,-.20402585426769815,1.1511384736390666};
static const double F_LAB[9]={1./116,1./500,0,1./116,0,0,1./116,0,-1./200};
static double bound(double x) { return x<0 ? 0 : (x>1 ? 1 : x); }
static void forward_lab(const double *rgb,double *lab,double *jac) {
    double f[3],derivative[3];
    const double threshold=216./24389, factor=108./841;
    for(int r=0;r<3;++r) {
        double x=0;
        for(int c=0;c<3;++c) x+=XYZ_M[r*3+c]*rgb[c];
        double cubic=cbrt(x>threshold ? x : threshold);
        f[r]=x>threshold ? cubic : x/factor+4./29;
        derivative[r]=x>threshold ? 1./(3*cubic*cubic) : 1./factor;
    }
    lab[0]=116*f[1]-16; lab[1]=500*(f[0]-f[1]); lab[2]=200*(f[1]-f[2]);
    for(int c=0;c<3;++c) {
        jac[c]=116*derivative[1]*XYZ_M[3+c];
        jac[3+c]=500*(derivative[0]*XYZ_M[c]-derivative[1]*XYZ_M[3+c]);
        jac[6+c]=200*(derivative[1]*XYZ_M[3+c]-derivative[2]*XYZ_M[6+c]);
    }
}
static void inverse_lab(const double *lab,double *rgb,double *jac) {
    double f[3],xyz[3],derivative[3];
    for(int r=0;r<3;++r) {
        f[r]=16./116;
        for(int c=0;c<3;++c) f[r]+=F_LAB[r*3+c]*lab[c];
        xyz[r]=f[r]>6./29 ? f[r]*f[r]*f[r] : (108./841)*(f[r]-4./29);
        derivative[r]=f[r]>6./29 ? 3*f[r]*f[r] : 108./841;
    }
    for(int r=0;r<3;++r) {
        rgb[r]=0;
        for(int c=0;c<3;++c) rgb[r]+=XYZ_INV[r*3+c]*xyz[c];
        for(int c=0;c<3;++c) {
            jac[r*3+c]=0;
            for(int a=0;a<3;++a) jac[r*3+c]+=XYZ_INV[r*3+a]*derivative[a]*F_LAB[a*3+c];
        }
    }
}

EXPORT double refine_objective(const double *original,const double *baseline,
    const double *weights,const double *matrix,const int64_t *pairs,
    const double *normal,const double *lost_weights,const double *safe_weights,
    const double *target,const double *parameters,double *gradient,double *work,
    size_t count,size_t clusters,size_t pair_count,double target_ratio,
    double slope,double protection,double regularization,double budget) {
    memset(gradient,0,clusters*3*sizeof(double));
    for(size_t i=0;i<count;++i) {
        double *w=work+i*36;
        double d[3],proposed[3],radius2=0,distance2=0,projection[9];
        for(int c=0;c<3;++c) {
            proposed[c]=baseline[i*3+c];
            for(size_t k=0;k<clusters;++k) proposed[c]+=weights[i*clusters+k]*parameters[k*3+c];
            d[c]=proposed[c]-original[i*3+c];
            double b=baseline[i*3+c]-original[i*3+c];
            radius2+=b*b; distance2+=d[c]*d[c];
        }
        double scale=distance2>radius2 ? sqrt(radius2/(distance2>1e-40 ? distance2 : 1e-40)) : 1;
        for(int r=0;r<3;++r) {
            proposed[r]=original[i*3+r]+scale*d[r];
            for(int c=0;c<3;++c) projection[r*3+c]=distance2>radius2
                ? scale*((r==c ? 1. : 0.)-d[r]*d[c]/(distance2>1e-40 ? distance2 : 1e-40))
                : (r==c ? 1. : 0.);
        }
        double linear[3],inverse[9];
        inverse_lab(proposed,linear,inverse);
        for(int r=0;r<3;++r) {
            int active=linear[r]>=0 && linear[r]<=1;
            linear[r]=bound(linear[r]);
            for(int c=0;c<3;++c) {
                w[12+r*3+c]=0;
                if(active) for(int a=0;a<3;++a) w[12+r*3+c]+=inverse[r*3+a]*projection[a*3+c];
            }
        }
        forward_lab(linear,w+21,w+24);
        double simulated[3],sim_jac[9];
        int active[3];
        for(int r=0;r<3;++r) {
            double v=0;
            for(int c=0;c<3;++c) v+=matrix[r*3+c]*linear[c];
            active[r]=v>=0 && v<=1; simulated[r]=bound(v);
        }
        forward_lab(simulated,w,sim_jac);
        for(int r=0;r<3;++r) for(int c=0;c<3;++c) {
            w[3+r*3+c]=0;
            for(int a=0;a<3;++a) if(active[a]) w[3+r*3+c]+=sim_jac[r*3+a]*matrix[a*3+c];
        }
        w[33]=w[34]=w[35]=0;
    }
    double loss=0;
    for(size_t p=0;p<pair_count;++p) {
        double *left=work+(size_t)pairs[p*2]*36,*right=work+(size_t)pairs[p*2+1]*36;
        double d[3],squared=1e-12;
        for(int c=0;c<3;++c) { d[c]=left[c]-right[c]; squared+=d[c]*d[c]; }
        double distance=sqrt(squared),ratio=distance/normal[p],z=slope*(target_ratio-ratio);
        double dz=-z; if(dz < -60) dz=-60; if(dz>60) dz=60;
        double derivative=0;
        if(lost_weights[p]>0) {
            loss+=lost_weights[p]*((z>0 ? z : 0)+log1p(exp(-fabs(z))));
            derivative-=lost_weights[p]*slope/(1+exp(dz))/normal[p];
        }
        double missing=target[p]>ratio ? target[p]-ratio : 0;
        loss+=protection*safe_weights[p]*missing*missing;
        derivative-=2*protection*safe_weights[p]*missing/normal[p];
        for(int c=0;c<3;++c) {
            double g=derivative/distance*d[c]; left[33+c]+=g; right[33+c]-=g;
        }
    }
    double reg=regularization/count/(1+budget*budget);
    for(size_t i=0;i<count;++i) {
        double *w=work+i*36,linear_gradient[3]={0,0,0},mapped[3]={0,0,0};
        for(int r=0;r<3;++r) {
            double d=w[21+r]-original[i*3+r];
            loss+=reg*d*d;
            for(int c=0;c<3;++c) linear_gradient[c]+=w[33+r]*w[3+r*3+c]+2*reg*d*w[24+r*3+c];
        }
        for(int c=0;c<3;++c) for(int r=0;r<3;++r) mapped[c]+=linear_gradient[r]*w[12+r*3+c];
        for(size_t k=0;k<clusters;++k) for(int c=0;c<3;++c) gradient[k*3+c]+=weights[i*clusters+k]*mapped[c];
    }
    return loss;
}
